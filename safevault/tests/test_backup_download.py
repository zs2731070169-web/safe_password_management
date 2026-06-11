"""加密备份下载（services/backup.download_backup + GET /backup 路由）测试 —— 对齐时序图 §2。

测试分两层，与工程既有风格（test_backup_upload.py）一致：业务逻辑走 service 直测，鉴权边界走
最小 app + TestClient。

业务编排（service 直测，用内存 dict 模拟对象存储：put 写入、get 读出，避免真连 MinIO/S3）：
  - 先 upload 再 download → 返回 ciphertext（base64 文本）== 上传原文、version/checksum/kdfParams
    与落库一致，且后端原样返回不解析
  - download 取回的 ciphertext 重新 base64 解码后 == 上传时的原始密文字节（编解码对称）
  - 该账户无备份 → BackupNotFoundError(404)

鉴权边界（路由层，最小 app + TestClient，无需 DB/Redis：缺/错 token 在依赖里、任何 IO 之前即拒）：
  - 缺 Authorization 头 → 401
  - 伪造 / 残缺 token → 401
"""
from __future__ import annotations

import base64
import hashlib
from collections.abc import AsyncGenerator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger
from sqlalchemy.ext.compiler import compiles

from api.backup import router as backup_router
from api.deps import get_current_user_id
from client.db_client import get_session
from config import settings
from core.exception.exceptions import BackupNotFoundError
from core.exception.exceptions import register_exception_handlers
from services import backup as backup_service
from services.backup import download_backup, upload_backup

from conftest import create_account


# 测试基建：与 upload 测试同源——本项目主键映射为 BIGINT（贴合 MySQL AUTO_INCREMENT），但 SQLite
# 仅对 INTEGER PRIMARY KEY 走 rowid 自增；BackupBlob 由 service 内部创建、测试无从插手其 id，故在
# SQLite 方言下把 BigInteger 渲染为 INTEGER 让自增别名生效（仅影响测试 DDL，生产 MySQL 不受影响）。
@compiles(BigInteger, "sqlite")
def _bigint_as_integer_on_sqlite(element, compiler, **kw):  # noqa: ANN001
    return "INTEGER"


# --------------------------------------------------------------------------- #
# 工具：构造合法的 ciphertext（base64 文本）与其 SHA-256 十六进制 checksum
# --------------------------------------------------------------------------- #
def _make_ciphertext(raw: bytes) -> str:
    """把原始字节封装成前端契约里的 base64 文本密文。"""
    return base64.b64encode(raw).decode("ascii")


def _checksum_of(raw: bytes) -> str:
    """对原始字节算 SHA-256 十六进制摘要（64 位 hex），模拟客户端上传的 checksum。"""
    return hashlib.sha256(raw).hexdigest()


_KDF_PARAMS = {"algorithm": "argon2id", "salt": "blob-salt", "iterations": 3}


@pytest.fixture
def fake_oss(monkeypatch):
    """用内存 dict 模拟对象存储，同时 monkeypatch services.backup 的 put_object / get_object。

    service 内是 `from core.oss.oss import put_object, get_object` 后直接调用，故名字绑定在
    services.backup 命名空间，替身打在 services.backup.* 上即可拦截（与 upload 测试的
    patched_put_object 同理）。put 写入 store、get 按 key 读出，使「先 upload 再 download」形成
    闭环，验证 base64 解码存 → 取后重新编码返回 的编解码对称。

    :returns: dict[key -> bytes] 模拟的对象存储，供测试断言 OSS 里存的是「解码后原始字节」
    """
    store: dict[str, bytes] = {}

    async def _fake_put_object(key: str, data: bytes) -> None:
        store[key] = data

    async def _fake_get_object(key: str) -> bytes:
        # 模拟「对象存在即返回字节」；测试不覆盖对象缺失场景（由元信息库无记录的 404 兜住主路径）
        return store[key]

    monkeypatch.setattr(backup_service, "put_object", _fake_put_object)
    monkeypatch.setattr(backup_service, "get_object", _fake_get_object)
    return store


# --------------------------------------------------------------------------- #
# 业务编排：service 直测
# --------------------------------------------------------------------------- #
async def test_download_after_upload_returns_consistent_blob(session, fake_oss):
    """先 upload 再 download：ciphertext（base64 文本）== 上传原文，version/checksum/kdfParams 一致。"""
    account, _ = await create_account(session, email="dl1@example.com")
    raw = b"the-encrypted-vault-blob-bytes-for-download"
    ciphertext = _make_ciphertext(raw)
    checksum = _checksum_of(raw)

    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=ciphertext,
        kdf_params=_KDF_PARAMS,
        version=1,
        checksum=checksum,
    )

    result = await download_backup(session=session, user_id=account.id)

    # 1) 严格按 §2 只返回这四个字段
    assert set(result.keys()) == {"ciphertext", "kdfParams", "version", "checksum"}
    # 2) ciphertext 原样回传（base64 文本，== 上传时的 base64 文本）
    assert result["ciphertext"] == ciphertext
    # 3) 重新 base64 解码后 == 上传时的原始密文字节（编解码对称：解码存 → 取后编码返回）
    assert base64.b64decode(result["ciphertext"]) == raw
    # 4) 元信息与落库一致：version、checksum（已归一化小写）、kdfParams 透传
    assert result["version"] == 1
    assert result["checksum"] == checksum.lower()
    assert result["kdfParams"] == _KDF_PARAMS
    # 5) OSS 里存的是「base64 解码后的原始字节」（非 base64 文本），与下载侧重新编码呼应
    assert fake_oss[f"{settings.oss_key_prefix}/{account.id}"] == raw


async def test_download_reflects_latest_after_overwrite(session, fake_oss):
    """覆盖上传后下载：返回的是最新一版（version 递增后的 blob 与元信息）。"""
    account, _ = await create_account(session, email="dl2@example.com")

    raw_v1 = b"download-snapshot-version-1"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_v1),
        kdf_params=_KDF_PARAMS,
        version=1,
        checksum=_checksum_of(raw_v1),
    )

    raw_v2 = b"download-snapshot-version-2-with-more-entries"
    new_kdf = {"algorithm": "argon2id", "salt": "blob-salt-2", "iterations": 4}
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_v2),
        kdf_params=new_kdf,
        version=2,
        checksum=_checksum_of(raw_v2),
    )

    result = await download_backup(session=session, user_id=account.id)
    assert result["version"] == 2
    assert base64.b64decode(result["ciphertext"]) == raw_v2
    assert result["checksum"] == _checksum_of(raw_v2)
    assert result["kdfParams"] == new_kdf


async def test_download_no_backup_raises_not_found(session, fake_oss):
    """该账户云端暂无备份 → BackupNotFoundError(404)，且不触达对象存储。"""
    account, _ = await create_account(session, email="dl3@example.com")
    with pytest.raises(BackupNotFoundError):
        await download_backup(session=session, user_id=account.id)


# --------------------------------------------------------------------------- #
# 鉴权边界：最小 app + TestClient（缺/错 token 在依赖里、任何 IO 之前即拒，无需 DB/Redis）
# --------------------------------------------------------------------------- #
def _build_client() -> TestClient:
    """构造仅挂 backup 路由的最小 app：注册业务异常处理器，并把 get_session 覆盖为不触库的空会话。

    get_current_user_id 依赖里 get_session 是其子依赖；缺/错 token 时在校验凭据阶段即抛
    TokenInvalidError，根本不会用到 session，故覆盖成 yield None 的空实现即可避免触发真实建连。
    不使用 `with TestClient(...)`，从而不触发 app 的 lifespan（不连 MySQL/Redis/MQ/OSS）。
    """
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(backup_router)

    async def _fake_session() -> AsyncGenerator[None, None]:
        yield None

    app.dependency_overrides[get_session] = _fake_session
    return TestClient(app)


def test_get_backup_missing_token_returns_401():
    """缺 Authorization 头 → 401。"""
    client = _build_client()
    resp = client.get("/backup")
    assert resp.status_code == 401


def test_get_backup_malformed_token_returns_401():
    """伪造 / 残缺 token（验签必失败）→ 401。"""
    client = _build_client()
    resp = client.get(
        "/backup",
        headers={"Authorization": "Bearer not.a.real.jwt"},
    )
    assert resp.status_code == 401
