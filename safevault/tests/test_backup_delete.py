"""加密备份删除（services/backup.delete_backup + DELETE /backup 路由）测试 —— 对齐时序图 §4。

方案 A：开关与删除解耦——本接口对应用户**显式点「删除云端备份」并二次确认**触发的彻底删除，
关闭云备份开关不调本接口（语义层面，不在后端测试覆盖范围内，由前端保证）。

测试分两层，与工程既有风格（test_backup_download.py / test_backup_meta.py）一致：业务逻辑走
service 直测，鉴权边界走最小 app + TestClient。

业务编排（service 直测，用内存 dict 模拟对象存储：put 写入、delete 移除，验证「先删元信息再清 blob」）：
  - 无备份删除 → { deleted: True }，**幂等**且全程不触 OSS（既不 put 也不 delete）
  - 先 upload 再 delete → { deleted: True }，且元信息已删（再查 get_backup_meta 得 hasBackup=False、
    download_backup 抛 BackupNotFoundError）、OSS 替身里对应 key 已被移除
  - 重复 delete → 仍 { deleted: True }（第二次走「无记录」幂等分支）

鉴权边界（路由层，最小 app + TestClient，无需 DB/Redis：缺/错 token 在依赖里、任何 IO 之前即拒）：
  - 缺 Authorization 头 → 401（注意是 DELETE 方法）
  - 伪造 / 残缺 token → 401（DELETE 方法）
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
from client.db_client import get_session
from config import settings
from core.exception.exceptions import BackupNotFoundError
from core.exception.exceptions import register_exception_handlers
from services import backup as backup_service
from services.backup import (
    delete_backup,
    download_backup,
    get_backup_meta,
    upload_backup,
)

from conftest import create_account


# 测试基建：与 upload / download / meta 测试同源——本项目主键映射为 BIGINT（贴合 MySQL
# AUTO_INCREMENT），但 SQLite 仅对 INTEGER PRIMARY KEY 走 rowid 自增；BackupBlob 由 service
# 内部创建、测试无从插手其 id，故在 SQLite 方言下把 BigInteger 渲染为 INTEGER 让自增别名生效
# （仅影响测试 DDL，生产 MySQL 不受影响）。
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


_KDF_PARAMS = {"algorithm": "argon2id", "salt": "delete-salt", "iterations": 3}
# 「密码包裹的 DataKey」密文占位（base64 文本，满足 schema/service 的非空约束）。delete 不解析它，
# 仅为让前置 upload_backup 的完整签名跑通（upload_backup 要求 wrapped_data_key 必填）。
_WRAPPED_DATA_KEY = base64.b64encode(b"wrapped-data-key-ciphertext").decode("ascii")


@pytest.fixture
def fake_oss(monkeypatch):
    """用内存 dict 模拟对象存储，monkeypatch services.backup 的 put_object / get_object / delete_object。

    service 内是 `from core.oss.oss import delete_object, get_object, put_object` 后直接调用，故名字
    绑定在 services.backup 命名空间，替身打在 services.backup.* 上即可拦截（与 download 测试的 fake_oss
    同理）。put 写入 store、delete 按 key 移除（模拟 S3 对缺失 key 幂等：用 pop(..., None) 不抛错），
    使「先 upload 再 delete」形成闭环，验证「先删元信息再清 blob」后 OSS 里对应 key 确已被移除。

    :returns: dict[key -> bytes] 模拟的对象存储，供测试断言 delete 后 key 已不在其中
    """
    store: dict[str, bytes] = {}

    async def _fake_put_object(key: str, data: bytes) -> None:
        store[key] = data

    async def _fake_get_object(key: str) -> bytes:
        return store[key]

    async def _fake_delete_object(key: str) -> None:
        # 模拟 S3 delete_object 对缺失 key 的幂等语义：pop 带默认值，缺失也不抛错。
        store.pop(key, None)

    monkeypatch.setattr(backup_service, "put_object", _fake_put_object)
    monkeypatch.setattr(backup_service, "get_object", _fake_get_object)
    monkeypatch.setattr(backup_service, "delete_object", _fake_delete_object)
    return store


async def _upload_one(session, user_id: int, raw: bytes, version: int = 1) -> None:
    """前置：给指定账户上传一份备份（完整签名，含 wrapped_data_key），供后续删除用例使用。"""
    await upload_backup(
        session=session,
        user_id=user_id,
        ciphertext=_make_ciphertext(raw),
        wrapped_data_key=_WRAPPED_DATA_KEY,
        kdf_params=_KDF_PARAMS,
        version=version,
        checksum=_checksum_of(raw),
    )


# --------------------------------------------------------------------------- #
# 业务编排：service 直测
# --------------------------------------------------------------------------- #
async def test_delete_no_backup_is_idempotent_and_skips_oss(session, fake_oss):
    """无备份删除 → { deleted: True }，幂等且全程不触 OSS（既不 put 也不 delete）。"""
    account, _ = await create_account(session, email="del1@example.com")

    # 该账户从未上传过备份；删除应直接走「无记录」幂等分支。
    result = await delete_backup(session=session, user_id=account.id)

    assert result == {"deleted": True}
    # 全程不触 OSS：store 始终为空（无 put 写入；delete 分支也未触达，因为无记录提前返回）。
    assert fake_oss == {}


async def test_delete_after_upload_removes_meta_and_blob(session, fake_oss):
    """先 upload 再 delete：{ deleted: True }，元信息已删（meta hasBackup=False、download 抛 404）、
    OSS 替身里对应 key 已被移除。"""
    account, _ = await create_account(session, email="del2@example.com")
    raw = b"the-encrypted-vault-blob-to-be-deleted"
    await _upload_one(session, account.id, raw, version=1)

    key = f"{settings.oss_key_prefix}/{account.id}"
    # 前置确认：上传后 OSS 里有这份、meta 命中。
    assert fake_oss[key] == raw
    meta_before = await get_backup_meta(session=session, user_id=account.id)
    assert meta_before["hasBackup"] is True

    # 执行删除
    result = await delete_backup(session=session, user_id=account.id)
    assert result == {"deleted": True}

    # 1) 元信息已删：meta 立即 hasBackup=False（先删元信息使「逻辑上无备份」即时生效）
    meta_after = await get_backup_meta(session=session, user_id=account.id)
    assert meta_after == {"hasBackup": False}

    # 2) 下载立即 404：BackupNotFoundError（元信息已无，无内容可取）
    with pytest.raises(BackupNotFoundError):
        await download_backup(session=session, user_id=account.id)

    # 3) OSS 实体 blob 也已被清理：对应 key 已从 store 移除（「再尽力清 blob」生效）
    assert key not in fake_oss


async def test_delete_twice_is_idempotent(session, fake_oss):
    """重复 delete：第一次命中删除、第二次走「无记录」幂等分支，两次均 { deleted: True }。"""
    account, _ = await create_account(session, email="del3@example.com")
    raw = b"snapshot-deleted-twice"
    await _upload_one(session, account.id, raw, version=1)

    first = await delete_backup(session=session, user_id=account.id)
    assert first == {"deleted": True}

    # 第二次删除：已无记录，仍稳定返回成功（客户端可无脑重试 / 重复点击）。
    second = await delete_backup(session=session, user_id=account.id)
    assert second == {"deleted": True}

    # 删除后 OSS 也无残留
    key = f"{settings.oss_key_prefix}/{account.id}"
    assert key not in fake_oss


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


def test_delete_backup_missing_token_returns_401():
    """缺 Authorization 头 → 401（DELETE 方法）。"""
    client = _build_client()
    resp = client.delete("/backup")
    assert resp.status_code == 401


def test_delete_backup_malformed_token_returns_401():
    """伪造 / 残缺 token（验签必失败）→ 401（DELETE 方法）。"""
    client = _build_client()
    resp = client.delete(
        "/backup",
        headers={"Authorization": "Bearer not.a.real.jwt"},
    )
    assert resp.status_code == 401
