"""STR 执行阶段补充测试（缺口覆盖 + 对齐当前业务真实行为）。

本文件由测试执行阶段新建，**不修改任何业务源码与既有测试**。目标：
  1. 覆盖既有 8 个测试文件的缺口：register / login / kdf-params / verify-code。
  2. 以「代码实际行为」为基线，对齐当前 upload_backup（新增 wrapped_data_key 必填参数、
     返回 {version, updatedAt}）与 reset_account（返回 {resetOk, recoverable}）的真实契约，
     补一组冒烟断言（既有 test_backup_upload / test_reset_password 因业务演进而过时、当前 FAIL，
     此处提供与现状一致的对照验证，证明业务行为本身自洽）。

底座沿用 conftest.py：内存 SQLite(aiosqlite) + fakeredis 真链路，不 mock DB/Redis 语义。
"""
from __future__ import annotations

import base64

import pytest
from sqlalchemy import BigInteger
from sqlalchemy.ext.compiler import compiles

from config import settings


# 测试基建（与既有 backup 测试同源解法）：本项目主键映射为 BIGINT（贴合 MySQL AUTO_INCREMENT），
# 但 SQLite 仅对 INTEGER PRIMARY KEY 走 rowid 自增。本文件涉及 register（不显式赋 account.id）与
# upload_backup（BackupBlob.id 由 service 内部创建、测试无从插手）两类「依赖自增主键」的路径，
# 故在 SQLite 方言下把 BigInteger 渲染为 INTEGER 让自增生效（仅影响测试 DDL，生产 MySQL 不受影响）。
@compiles(BigInteger, "sqlite")
def _bigint_as_integer_on_sqlite(element, compiler, **kw):  # noqa: ANN001
    return "INTEGER"
from core.exception.exceptions import (
    AccountLockedError,
    AuthFailedError,
    BackupVersionConflictError,
    EmailExistsError,
    InvalidChecksumError,
    InvalidCodeError,
)
from services.backup import upload_backup
from services.login import login_account
from services.register import register_account
from services.reset_password import reset_account
from services.token import decode_access_token
from services.verify_code import verify_code

from conftest import create_account, make_kdf_params, seal_password


def _code_key(email: str) -> str:
    return f"code:{email}"


def _fail_key(email: str) -> str:
    return f"fail:{email}"


def _whitelist_key(user_id: int) -> str:
    return f"refresh:{user_id}"


def _patch_put_object(monkeypatch) -> None:
    """给 services.backup.put_object 打最小替身（吞写入），让 upload_backup 直测不连真实 OSS。"""
    from services import backup as backup_service

    async def _noop_put_object(key: str, data: bytes) -> None:  # noqa: ARG001
        return None

    monkeypatch.setattr(backup_service, "put_object", _noop_put_object)


# --------------------------------------------------------------------------- #
# BE-REG 注册 register_account
# --------------------------------------------------------------------------- #
class TestRegister:
    async def test_register_success_returns_tokens_and_userid(self, session, fake_redis):
        """BE-REG-01 验证码正确 + 邮箱未注册 → 返回 {tokens, userId}，注册即登录。"""
        email = "newuser@example.com"
        await fake_redis.set(_code_key(email), "654321")

        result = await register_account(
            session=session,
            email=email,
            sealed_password=seal_password("Brand@New2025"),
            code="654321",
        )

        assert set(result.keys()) == {"tokens", "userId"}
        assert set(result["tokens"].keys()) == {"accessToken", "refreshToken"}
        assert isinstance(result["userId"], int)
        # access 携带的 userId 与返回一致，新账户 token_version 默认 1
        uid, tv = decode_access_token(result["tokens"]["accessToken"])
        assert uid == result["userId"]
        assert tv == 1
        # 用后即焚：验证码已被删除
        assert await fake_redis.get(_code_key(email)) is None
        # refresh 已写入白名单
        assert await fake_redis.scard(_whitelist_key(result["userId"])) == 1

    async def test_register_wrong_code_rejected(self, session, fake_redis):
        """BE-REG-02 验证码不符 → InvalidCodeError(400)，不落库。"""
        email = "wrongcode@example.com"
        await fake_redis.set(_code_key(email), "111111")
        with pytest.raises(InvalidCodeError):
            await register_account(
                session=session,
                email=email,
                sealed_password=seal_password("Whatever@2025"),
                code="999999",
            )

    async def test_register_missing_code_rejected(self, session, fake_redis):
        """BE-REG-03 验证码缺失（从未发码）→ InvalidCodeError(400)。"""
        with pytest.raises(InvalidCodeError):
            await register_account(
                session=session,
                email="nocode@example.com",
                sealed_password=seal_password("Whatever@2025"),
                code="123456",
            )

    async def test_register_duplicate_email_rejected(self, session, fake_redis):
        """BE-REG-04 邮箱已注册 → EmailExistsError(409)。"""
        email = "dup@example.com"
        await create_account(session, email=email)
        await fake_redis.set(_code_key(email), "222222")
        with pytest.raises(EmailExistsError):
            await register_account(
                session=session,
                email=email,
                sealed_password=seal_password("Whatever@2025"),
                code="222222",
            )


# --------------------------------------------------------------------------- #
# BE-LGN 登录 login_account / 失败锁定（认证已改为非对称封装上送密码）
# --------------------------------------------------------------------------- #
class TestLogin:
    async def test_login_success(self, session, fake_redis):
        """BE-LGN-01 正确凭据 → {tokens, userId}，access 的 tv 与账户一致。"""
        account, password = await create_account(
            session, email="login@example.com", password="Right@2024", token_version=3
        )
        result = await login_account(
            session=session,
            email="login@example.com",
            sealed_password=seal_password(password),
        )
        assert result["userId"] == account.id
        uid, tv = decode_access_token(result["tokens"]["accessToken"])
        assert (uid, tv) == (account.id, 3)

    async def test_login_wrong_password_401_and_counts_failure(self, session, fake_redis):
        """BE-LGN-02 口令不符 → AuthFailedError(401) 且 fail 计数 +1。"""
        await create_account(session, email="bad@example.com", password="Right@2024")
        with pytest.raises(AuthFailedError):
            await login_account(
                session=session,
                email="bad@example.com",
                sealed_password=seal_password("Wrong@0000"),
            )
        assert int(await fake_redis.get(_fail_key("bad@example.com"))) == 1

    async def test_login_unknown_email_same_401(self, session, fake_redis):
        """BE-LGN-03 邮箱不存在 → 同样 401（不泄露账户是否存在）且计 fail。"""
        with pytest.raises(AuthFailedError):
            await login_account(
                session=session,
                email="ghost@example.com",
                sealed_password=seal_password("whatever"),
            )
        assert int(await fake_redis.get(_fail_key("ghost@example.com"))) == 1

    async def test_login_locked_when_threshold_reached(self, session, fake_redis):
        """BE-LGN-04 失败计数达到阈值 → AccountLockedError(423)，不再触库比对。"""
        email = "locked@example.com"
        await create_account(session, email=email, password="Right@2024")
        # 预置失败计数到阈值
        await fake_redis.set(_fail_key(email), settings.login_fail_threshold)
        with pytest.raises(AccountLockedError):
            await login_account(
                session=session,
                email=email,
                sealed_password=seal_password("Right@2024"),
            )

    async def test_login_success_clears_failure_count(self, session, fake_redis):
        """BE-LGN-05 登录成功 → 清零 fail:{email}。"""
        email = "clear@example.com"
        _, password = await create_account(session, email=email, password="Right@2024")
        await fake_redis.set(_fail_key(email), 3)  # 阈值以下，仍可登录
        await login_account(
            session=session, email=email, sealed_password=seal_password(password)
        )
        assert await fake_redis.get(_fail_key(email)) is None

    async def test_login_disabled_account_rejected(self, session, fake_redis):
        """BE-LGN-06 账户停用(status!=1) → 即便口令正确也 401。"""
        from models.account import Account
        from sqlalchemy import update

        account, password = await create_account(
            session, email="disabled@example.com", password="Right@2024"
        )
        await session.execute(
            update(Account).where(Account.id == account.id).values(status=0)
        )
        await session.flush()
        with pytest.raises(AuthFailedError):
            await login_account(
                session=session,
                email="disabled@example.com",
                sealed_password=seal_password(password),
            )


# --------------------------------------------------------------------------- #
# BE-SEAL 密码封装解封 decrypt_sealed（替代旧 kdf-params 防枚举往返）
# --------------------------------------------------------------------------- #
class TestSeal:
    async def test_seal_round_trip(self, session, fake_redis):
        """BE-SEAL-01 客户端封装 → 服务端解封还原同一明文（含中文 / 特殊字符）。"""
        from services.seal import decrypt_sealed

        plaintext = "P@ss-密码-2025"
        assert decrypt_sealed(seal_password(plaintext)) == plaintext

    async def test_seal_invalid_payload_rejected(self, session, fake_redis):
        """BE-SEAL-02 非法封装（截断 / 篡改）→ SealDecryptError(400)。"""
        from core.exception.exceptions import SealDecryptError
        from services.seal import decrypt_sealed

        with pytest.raises(SealDecryptError):
            decrypt_sealed("not-a-valid-base64-sealed-payload!!!")


# --------------------------------------------------------------------------- #
# BE-VC 验证码 verify_code
# --------------------------------------------------------------------------- #
class TestVerifyCode:
    async def test_verify_code_ok(self, session, fake_redis):
        """BE-VC-01 验证码匹配 → 不抛异常；且 verify 本身不删码（用后即焚由编排做）。"""
        await fake_redis.set(_code_key("vc@example.com"), "424242")
        await verify_code("vc@example.com", "424242")
        # verify_code 不负责删除
        assert await fake_redis.get(_code_key("vc@example.com")) == "424242"

    async def test_verify_code_mismatch(self, session, fake_redis):
        """BE-VC-02 验证码不符 → InvalidCodeError。"""
        await fake_redis.set(_code_key("vc2@example.com"), "111111")
        with pytest.raises(InvalidCodeError):
            await verify_code("vc2@example.com", "000000")

    async def test_verify_code_missing(self, session, fake_redis):
        """BE-VC-03 从未发码 → InvalidCodeError（与「不符」同一错误，防探测）。"""
        with pytest.raises(InvalidCodeError):
            await verify_code("none@example.com", "123456")


# --------------------------------------------------------------------------- #
# BE-BK 备份上传（对齐当前真实契约：wrapped_data_key 必填 + 返回 {version, updatedAt}）
# --------------------------------------------------------------------------- #
class TestBackupUploadCurrentContract:
    def _ciphertext(self, raw: bytes) -> str:
        return base64.b64encode(raw).decode("ascii")

    def _checksum(self, raw: bytes) -> str:
        import hashlib

        return hashlib.sha256(raw).hexdigest()

    async def test_upload_first_backup_returns_version_and_updatedat(
        self, session, fake_redis, monkeypatch
    ):
        """BE-BK-01 首次上传成功 → 返回 {version, updatedAt}（当前真实契约，含 wrapped_data_key）。"""
        _patch_put_object(monkeypatch)
        account, _ = await create_account(session, email="bk1@example.com")
        raw = b"encrypted-vault-snapshot-bytes"
        result = await upload_backup(
            session=session,
            user_id=account.id,
            ciphertext=self._ciphertext(raw),
            wrapped_data_key=base64.b64encode(b"wrapped-dek-blob").decode("ascii"),
            kdf_params=make_kdf_params("bk-salt"),
            version=1,
            checksum=self._checksum(raw),
        )
        assert set(result.keys()) == {"version", "updatedAt"}
        assert result["version"] == 1

    async def test_upload_version_rollback_rejected(
        self, session, fake_redis, monkeypatch
    ):
        """BE-BK-02 非 force 下 version ≤ 云端当前 → BackupVersionConflictError(409 防回退)。"""
        _patch_put_object(monkeypatch)
        account, _ = await create_account(session, email="bk2@example.com")
        raw = b"snapshot-v5"
        common = dict(
            session=session,
            user_id=account.id,
            ciphertext=self._ciphertext(raw),
            wrapped_data_key=base64.b64encode(b"dek").decode("ascii"),
            kdf_params=make_kdf_params("s"),
            checksum=self._checksum(raw),
        )
        await upload_backup(version=5, **common)
        with pytest.raises(BackupVersionConflictError):
            await upload_backup(version=5, **common)  # 等于云端，非 force → 409

    async def test_upload_invalid_checksum_rejected(
        self, session, fake_redis, monkeypatch
    ):
        """BE-BK-03 checksum 非 64 位 hex → InvalidChecksumError(400)。"""
        _patch_put_object(monkeypatch)
        account, _ = await create_account(session, email="bk3@example.com")
        raw = b"x"
        with pytest.raises(InvalidChecksumError):
            await upload_backup(
                session=session,
                user_id=account.id,
                ciphertext=self._ciphertext(raw),
                wrapped_data_key=base64.b64encode(b"dek").decode("ascii"),
                kdf_params=make_kdf_params("s"),
                version=1,
                checksum="not-a-valid-checksum",
            )


# --------------------------------------------------------------------------- #
# BE-RST 重置（对齐当前真实契约：返回 {resetOk, recoverable}）
# --------------------------------------------------------------------------- #
class TestResetCurrentContract:
    async def test_reset_returns_recoverable_and_invalidates_sessions(
        self, session, fake_redis
    ):
        """BE-RST-01 重置成功 → 返回 {resetOk, recoverable}（当前真实契约，无 cloudBackupCleared），
        token_version 自增、refresh 白名单清空、验证码删除。"""
        account, _ = await create_account(
            session, email="rst@example.com", token_version=5
        )
        await fake_redis.set(_code_key("rst@example.com"), "123456")
        await fake_redis.sadd(_whitelist_key(account.id), "jti-x", "jti-y")

        result = await reset_account(
            session=session,
            email="rst@example.com",
            sealed_new_password=seal_password("BrandNew@2025"),
            code="123456",
        )

        assert result == {"resetOk": True, "recoverable": True}
        # 会话全失效：token_version 自增
        await session.refresh(account)
        assert account.token_version == 6
        # refresh 白名单清空
        assert await fake_redis.scard(_whitelist_key(account.id)) == 0
        # 验证码用后即焚
        assert await fake_redis.get(_code_key("rst@example.com")) is None

    async def test_reset_wrong_code_rejected(self, session, fake_redis):
        """BE-RST-02 验证码不符 → InvalidCodeError(400)。"""
        await create_account(session, email="rst2@example.com")
        await fake_redis.set(_code_key("rst2@example.com"), "123456")
        with pytest.raises(InvalidCodeError):
            await reset_account(
                session=session,
                email="rst2@example.com",
                sealed_new_password=seal_password("BrandNew@2025"),
                code="000000",
            )
