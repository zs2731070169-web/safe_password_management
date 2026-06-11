"""加密备份上传（services/backup + PUT /backup 路由）测试 —— 对齐时序图 §1。

测试分两层，与工程既有风格一致（业务逻辑走 service 直测，鉴权边界走最小 app + TestClient）：

业务编排（service 直测，monkeypatch put_object 避免真连阿里云 OSS）：
  - 首次上传成功 → 落库 version/checksum/size 正确、put_object 收到「base64 解码后的原始字节」、
    返回 { version, updatedAt }
  - 覆盖上传成功（version 递增）→ 同一账户记录被 UPDATE，仍只一条
  - version 回退（≤ 云端当前，未带 force）→ BackupVersionConflictError(409)，且不写 OSS、不改库
  - force=True 本地落后云端 → 绕过版本序、无条件覆盖，落库 version 重置为 max(上传, 云端+1) 重建基线，
    且重建后同设备常规上传正常前进、不再 409
  - force=True 本地已领先 → 落库 version 取上传值，不无谓抬高
  - checksum 格式非法（非 64 位 hex）→ InvalidChecksumError(400)
  - ciphertext 非合法 base64 → InvalidChecksumError(400)（边界脏数据，复用 400 通道）
  - 体积超限（解码后字节数 > 上限）→ BackupTooLargeError(413)，且不写 OSS

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
from sqlalchemy import BigInteger, func, select
from sqlalchemy.ext.compiler import compiles

from api.backup import router as backup_router
from api.deps import get_current_user_id
from client.db_client import get_session
from config import settings
from core.exception.exceptions import (
    BackupTooLargeError,
    BackupVersionConflictError,
    InvalidChecksumError,
)
from core.exception.exceptions import register_exception_handlers
from models.backup import BackupBlob
from services import backup as backup_service
from services.backup import upload_backup

from conftest import create_account


# 测试基建：本项目主键映射为 BIGINT（贴合 MySQL AUTO_INCREMENT），但 SQLite 仅对
# INTEGER PRIMARY KEY 走 rowid 自增别名，BIGINT 主键不自增 → service 内不带 id 的
# INSERT 会因主键为 NULL 失败。auth 测试靠「显式赋 id」绕过，但 BackupBlob 由 service
# 内部创建、测试无从插手其 id。故在 SQLite 方言下把 BigInteger 渲染为 INTEGER，让自增
# 别名生效（仅影响测试用 SQLite 的 DDL；生产 MySQL 仍是 BIGINT AUTO_INCREMENT，不受影响）。
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
def patched_put_object(monkeypatch):
    """monkeypatch services.backup.put_object → 记录调用、不真连 OSS。

    service 内是 `from client.oss_client import put_object` 后直接调用，故名字绑定在
    services.backup 命名空间，替身打在 services.backup.put_object 上即可拦截。
    """
    calls: list[tuple[str, bytes]] = []

    async def _fake_put_object(key: str, data: bytes) -> None:
        calls.append((key, data))

    monkeypatch.setattr(backup_service, "put_object", _fake_put_object)
    return calls


# --------------------------------------------------------------------------- #
# 业务编排：service 直测
# --------------------------------------------------------------------------- #
async def test_upload_first_backup_success(session, patched_put_object):
    """首次上传：落库元信息正确，put_object 收到解码后的原始字节，返回 version/updatedAt。"""
    account, _ = await create_account(session, email="backup1@example.com")
    raw = b"the-encrypted-vault-blob-bytes"  # 30 字节原始密文
    ciphertext = _make_ciphertext(raw)
    checksum = _checksum_of(raw)

    result = await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=ciphertext,
        kdf_params=_KDF_PARAMS,
        version=1,
        checksum=checksum,
    )

    # 1) 返回体：version 回显、updatedAt 为元信息更新时间（datetime）
    assert result["version"] == 1
    assert result["updatedAt"] is not None

    # 2) put_object 被调用一次，key=backup/{userId}，data 为 base64 解码后的原始字节（非 base64 文本）
    assert len(patched_put_object) == 1
    key, data = patched_put_object[0]
    assert key == f"{settings.oss_key_prefix}/{account.id}"
    assert data == raw

    # 3) 落库元信息：每账户一条，version/checksum（归一化小写）/size_bytes/valid/object_key 正确
    blob = await session.scalar(
        select(BackupBlob).where(BackupBlob.account_id == account.id)
    )
    assert blob is not None
    assert blob.version == 1
    assert blob.checksum == checksum.lower()
    assert blob.size_bytes == len(raw)
    assert blob.valid == 1
    assert blob.object_key == f"{settings.oss_key_prefix}/{account.id}"
    assert blob.kdf_params == _KDF_PARAMS


async def test_upload_overwrites_with_higher_version(session, patched_put_object):
    """覆盖上传（version 递增）：同账户记录被 UPDATE，仍只一条，字段刷新为新值。"""
    account, _ = await create_account(session, email="backup2@example.com")

    raw_v1 = b"vault-snapshot-version-1"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_v1),
        kdf_params=_KDF_PARAMS,
        version=1,
        checksum=_checksum_of(raw_v1),
    )

    raw_v2 = b"vault-snapshot-version-2-with-more-entries"
    new_kdf = {"algorithm": "argon2id", "salt": "blob-salt-2", "iterations": 4}
    result = await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_v2),
        kdf_params=new_kdf,
        version=2,
        checksum=_checksum_of(raw_v2),
    )

    assert result["version"] == 2
    # 仍只一条（覆盖式，uk_backup_account 每账户一份）
    count = await session.scalar(
        select(func.count()).select_from(BackupBlob).where(
            BackupBlob.account_id == account.id
        )
    )
    assert count == 1
    blob = await session.scalar(
        select(BackupBlob).where(BackupBlob.account_id == account.id)
    )
    assert blob.version == 2
    assert blob.size_bytes == len(raw_v2)
    assert blob.checksum == _checksum_of(raw_v2)
    assert blob.kdf_params == new_kdf
    # 两次 put_object（v1、v2）
    assert len(patched_put_object) == 2


async def test_upload_version_rollback_rejected(session, patched_put_object):
    """version ≤ 云端当前 → 409，且不再写 OSS、库内仍是旧版本。"""
    account, _ = await create_account(session, email="backup3@example.com")
    raw = b"vault-snapshot-at-version-5"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw),
        kdf_params=_KDF_PARAMS,
        version=5,
        checksum=_checksum_of(raw),
    )
    assert len(patched_put_object) == 1  # 首传已写一次

    # 用相等版本（5）回退上传 → 409
    with pytest.raises(BackupVersionConflictError):
        await upload_backup(
            session=session,
            user_id=account.id,
            ciphertext=_make_ciphertext(b"stale-snapshot"),
            kdf_params=_KDF_PARAMS,
            version=5,
            checksum=_checksum_of(b"stale-snapshot"),
        )

    # 用更低版本（3）回退上传 → 409
    with pytest.raises(BackupVersionConflictError):
        await upload_backup(
            session=session,
            user_id=account.id,
            ciphertext=_make_ciphertext(b"older-snapshot"),
            kdf_params=_KDF_PARAMS,
            version=3,
            checksum=_checksum_of(b"older-snapshot"),
        )

    # 防回退：OSS 未再被写（仍是 1 次），库内仍是 version 5
    assert len(patched_put_object) == 1
    blob = await session.scalar(
        select(BackupBlob).where(BackupBlob.account_id == account.id)
    )
    assert blob.version == 5


async def test_force_overwrite_bypasses_version_and_rebuilds_baseline(
    session, patched_put_object
):
    """force=True 且本地落后云端：无条件覆盖，落库 version 重置为 max(上传, 云端+1) 重建基线，
    且重建后同设备的常规上传正常前进、不再触发 409。"""
    account, _ = await create_account(session, email="backup7@example.com")
    # 先把云端推到 version 10
    raw_hi = b"cloud-snapshot-at-version-10"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_hi),
        kdf_params=_KDF_PARAMS,
        version=10,
        checksum=_checksum_of(raw_hi),
    )

    # 新设备本地仅到 version 3，用户显式「用本机数据覆盖云端」→ force=True
    raw_local = b"this-device-local-snapshot"
    result = await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_local),
        kdf_params=_KDF_PARAMS,
        version=3,
        checksum=_checksum_of(raw_local),
        force=True,
    )

    # 落库 version 重置为 max(3, 10+1)=11；blob 内容换成本机这份（覆盖成功）
    assert result["version"] == 11
    blob = await session.scalar(
        select(BackupBlob).where(BackupBlob.account_id == account.id)
    )
    assert blob.version == 11
    assert blob.size_bytes == len(raw_local)
    assert blob.checksum == _checksum_of(raw_local)
    assert len(patched_put_object) == 2  # 高版本首传 + force 覆盖各一次

    # 重建基线后：同设备下一次常规上传（version=12 > 11）正常前进、无 409
    raw_next = b"next-normal-snapshot-after-force"
    nxt = await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw_next),
        kdf_params=_KDF_PARAMS,
        version=12,
        checksum=_checksum_of(raw_next),
    )
    assert nxt["version"] == 12


async def test_force_with_higher_local_version_keeps_uploaded_value(
    session, patched_put_object
):
    """force=True 但本地已领先（version > 云端）：落库 version 取上传值，不无谓抬高。"""
    account, _ = await create_account(session, email="backup8@example.com")
    raw1 = b"snapshot-v2"
    await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw1),
        kdf_params=_KDF_PARAMS,
        version=2,
        checksum=_checksum_of(raw1),
    )

    raw2 = b"snapshot-v5-forced"
    result = await upload_backup(
        session=session,
        user_id=account.id,
        ciphertext=_make_ciphertext(raw2),
        kdf_params=_KDF_PARAMS,
        version=5,
        checksum=_checksum_of(raw2),
        force=True,
    )
    # max(5, 2+1)=5，取上传值
    assert result["version"] == 5


async def test_upload_invalid_checksum_rejected(session, patched_put_object):
    """checksum 非 64 位十六进制 → 400，且不写 OSS。"""
    account, _ = await create_account(session, email="backup4@example.com")
    raw = b"some-valid-blob-bytes"
    with pytest.raises(InvalidChecksumError):
        await upload_backup(
            session=session,
            user_id=account.id,
            ciphertext=_make_ciphertext(raw),
            kdf_params=_KDF_PARAMS,
            version=1,
            checksum="not-a-valid-sha256-hex",  # 长度 / 字符均非法
        )
    assert len(patched_put_object) == 0


async def test_upload_malformed_base64_ciphertext_rejected(session, patched_put_object):
    """ciphertext 非合法 base64 → 400（边界脏数据，复用 InvalidChecksumError 的 400 通道）。"""
    account, _ = await create_account(session, email="backup5@example.com")
    with pytest.raises(InvalidChecksumError):
        await upload_backup(
            session=session,
            user_id=account.id,
            ciphertext="!!! not base64 !!!",
            kdf_params=_KDF_PARAMS,
            version=1,
            checksum=_checksum_of(b"whatever"),
        )
    assert len(patched_put_object) == 0


async def test_upload_too_large_rejected(session, patched_put_object, monkeypatch):
    """解码后字节数 > 上限 → 413，且不写 OSS。把上限临时调小避免造大 payload。"""
    account, _ = await create_account(session, email="backup6@example.com")
    # 把上限压到 10 字节，使一份 32 字节的密文必然超限
    monkeypatch.setattr(settings, "backup_max_size_bytes", 10)
    raw = b"x" * 32
    with pytest.raises(BackupTooLargeError):
        await upload_backup(
            session=session,
            user_id=account.id,
            ciphertext=_make_ciphertext(raw),
            kdf_params=_KDF_PARAMS,
            version=1,
            checksum=_checksum_of(raw),
        )
    assert len(patched_put_object) == 0


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


# 一份合法请求体，确保只有鉴权失败、而非请求体 422，干扰 401 断言
_VALID_BODY = {
    "ciphertext": base64.b64encode(b"a-valid-ciphertext-blob").decode("ascii"),
    "kdfParams": _KDF_PARAMS,
    "version": 1,
    "checksum": hashlib.sha256(b"a-valid-ciphertext-blob").hexdigest(),
}


def test_put_backup_missing_token_returns_401():
    """缺 Authorization 头 → 401。"""
    client = _build_client()
    resp = client.put("/backup", json=_VALID_BODY)
    assert resp.status_code == 401


def test_put_backup_malformed_token_returns_401():
    """伪造 / 残缺 token（验签必失败）→ 401。"""
    client = _build_client()
    resp = client.put(
        "/backup",
        json=_VALID_BODY,
        headers={"Authorization": "Bearer not.a.real.jwt"},
    )
    assert resp.status_code == 401
