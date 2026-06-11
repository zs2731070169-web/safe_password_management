"""加密备份元信息（services/backup.get_backup_meta + GET /backup/meta 路由）测试 —— 对齐时序图 §3。

测试分两层，与工程既有风格（test_backup_download.py / test_backup_upload.py）一致：业务逻辑走
service 直测，鉴权边界走最小 app + TestClient。

业务编排（service 直测）：
  - 该账户无备份 → 返回 { hasBackup: False }（**不抛异常**，与 §2 下载的 404 刻意区分）
  - 先 upload 再取 meta → { hasBackup: True, version, size, updatedAt }，且 size==原始字节数、
    version 与落库一致、updatedAt 非空；响应**不含** ciphertext / checksum / kdfParams
  - 覆盖上传后取 meta → 反映最新一版的 version 与 size（编解码 / 选列查询无串档）

鉴权边界（路由层，最小 app + TestClient，无需 DB/Redis：缺/错 token 在依赖里、任何 IO 之前即拒）：
  - 缺 Authorization 头 → 401
  - 伪造 / 残缺 token → 401
"""
from __future__ import annotations

import base64
import hashlib
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger
from sqlalchemy.ext.compiler import compiles

from api.backup import router as backup_router
from client.db_client import get_session
from core.exception.exceptions import register_exception_handlers
from services.backup import get_backup_meta, upload_backup

from conftest import create_account


# 测试基建：与 upload / download 测试同源——本项目主键映射为 BIGINT（贴合 MySQL AUTO_INCREMENT），但
# SQLite 仅对 INTEGER PRIMARY KEY 走 rowid 自增；BackupBlob 由 service 内部创建、测试无从插手其 id，
# 故在 SQLite 方言下把 BigInteger 渲染为 INTEGER 让自增别名生效（仅影响测试 DDL，生产 MySQL 不受影响）。
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


_KDF_PARAMS = {"algorithm": "argon2id", "salt": "meta-salt", "iterations": 3}


# --------------------------------------------------------------------------- #
# 业务编排：service 直测
#
# 注意：get_backup_meta 只查元信息库（version / size_bytes / updated_at），**不触达对象存储**，
# 故无需 fake_oss 替身。但 upload_backup 写入时要写 OSS，需在直测里给 put_object 打个最小替身。
# --------------------------------------------------------------------------- #
def _patch_put_object(monkeypatch) -> None:
    """给 services.backup.put_object 打最小替身（吞掉写入），让 upload_backup 在直测里跑通而不连 OSS。

    get_backup_meta 自身不调用任何 OSS 接口，故只需让前置的 upload 能落库即可，无需保留写入内容。
    """
    from services import backup as backup_service

    async def _noop_put_object(key: str, data: bytes) -> None:  # noqa: ARG001
        return None

    monkeypatch.setattr(backup_service, "put_object", _noop_put_object)


async def test_meta_no_backup_returns_has_backup_false(session):
    """该账户云端暂无备份 → { hasBackup: False }，**不抛异常**（与 §2 下载的 404 刻意区分）。"""
    account, _ = await create_account(session, email="meta1@example.com")

    result = await get_backup_meta(session=session, user_id=account.id)

    # 无备份是正常查询结果（非错误）：只回 hasBackup=False，不含其余字段。
    assert result == {"hasBackup": False}


async def test_meta_after_upload_returns_full_fields(session, monkeypatch):
    """先 upload 再取 meta：{ hasBackup: True, version, size, updatedAt }，且不含密文/校验/配方。"""
    _patch_put_object(monkeypatch)
    account, _ = await create_account(session, email="meta2@example.com")

    raw = b"the-encrypted-vault-blob-bytes-for-meta-probe"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw),
        kdf_params=_KDF_PARAMS,
        version=7,
        checksum=_checksum_of(raw),
    )

    result = await get_backup_meta(session=session, user_id=account.id)

    # 1) 严格只回 §3 的四个键（hasBackup + version/size/updatedAt），不含 ciphertext/checksum/kdfParams。
    assert set(result.keys()) == {"hasBackup", "version", "size", "updatedAt"}
    assert "ciphertext" not in result
    assert "checksum" not in result
    assert "kdfParams" not in result
    # 2) 命中态
    assert result["hasBackup"] is True
    # 3) version 与落库一致
    assert result["version"] == 7
    # 4) size 取库列 size_bytes == 密文原始字节数（非 base64 文本长度）
    assert result["size"] == len(raw)
    # 5) updatedAt 由 TimestampMixin 写回，非空
    assert result["updatedAt"] is not None


async def test_meta_reflects_latest_after_overwrite(session, monkeypatch):
    """覆盖上传后取 meta：反映最新一版的 version 与 size（选列查询无串档）。"""
    _patch_put_object(monkeypatch)
    account, _ = await create_account(session, email="meta3@example.com")

    raw_v1 = b"meta-snapshot-version-1"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_v1),
        kdf_params=_KDF_PARAMS,
        version=1,
        checksum=_checksum_of(raw_v1),
    )

    raw_v2 = b"meta-snapshot-version-2-with-noticeably-more-bytes"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_v2),
        kdf_params=_KDF_PARAMS,
        version=2,
        checksum=_checksum_of(raw_v2),
    )

    result = await get_backup_meta(session=session, user_id=account.id)
    assert result["hasBackup"] is True
    assert result["version"] == 2
    assert result["size"] == len(raw_v2)


# --------------------------------------------------------------------------- #
# 鉴权边界：最小 app + TestClient（缺/错 token 在依赖里、任何 IO 之前即拒，无需 DB/Redis）
# --------------------------------------------------------------------------- #
def _build_client() -> TestClient:
    """构造仅挂 backup 路由的最小 app：注册业务异常处理器，并把 get_session 覆盖为不触库的空会话。

    与 test_backup_download._build_client 同理：get_current_user_id 在缺/错 token 时于校验凭据阶段即抛
    TokenInvalidError，根本不会用到 session，故覆盖成 yield None 的空实现即可避免触发真实建连；
    不使用 `with TestClient(...)`，从而不触发 app 的 lifespan（不连 MySQL/Redis/MQ/OSS）。
    """
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(backup_router)

    async def _fake_session() -> AsyncGenerator[None, None]:
        yield None

    app.dependency_overrides[get_session] = _fake_session
    return TestClient(app)


def test_get_backup_meta_missing_token_returns_401():
    """缺 Authorization 头 → 401。"""
    client = _build_client()
    resp = client.get("/backup/meta")
    assert resp.status_code == 401


def test_get_backup_meta_malformed_token_returns_401():
    """伪造 / 残缺 token（验签必失败）→ 401。"""
    client = _build_client()
    resp = client.get(
        "/backup/meta",
        headers={"Authorization": "Bearer not.a.real.jwt"},
    )
    assert resp.status_code == 401
