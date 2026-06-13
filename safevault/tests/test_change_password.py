"""改密服务（services/change_password）测试 —— 方案 B 严格立即失效。

覆盖：
  - 旧密码错误 → OldPasswordError(401)，且不改任何库字段、不动 token_version
  - 新旧密码相同 → SamePasswordError(400)
  - 改密成功 → token_version 自增 + verifier/server_salt/kdf_params 真实更新 + refresh 白名单
    被 DEL 清空 + tokenver 缓存刷新为新值 + 返回 { success, relogin } 不含 token
  - 账户不存在 → TokenInvalidError(401)
"""
from __future__ import annotations

import pytest

from core.exception.exceptions import (
    OldPasswordError,
    SamePasswordError,
    TokenInvalidError,
)
from models.account import Account
from services.change_password import change_password
from services.token import _token_version_key, _whitelist_key

from conftest import create_account, seal_password


async def test_change_password_success_invalidates_all_sessions(session, fake_redis):
    """改密成功：version 自增 + 落库 + 清 refresh + 刷新缓存 + 不返回 token。"""
    account, old_password = await create_account(
        session, password="OldPass@2024", token_version=3
    )
    old_password_verifier = account.password_verifier
    old_server_salt = account.server_salt

    # 预置：该用户有两台设备的 refresh jti 在白名单，且 tokenver 缓存为旧值 3
    await fake_redis.sadd(_whitelist_key(account.id), "jti-device-a", "jti-device-b")
    await fake_redis.set(_token_version_key(account.id), 3)

    result = await change_password(
        session=session,
        user_id=account.id,
        sealed_old_password=seal_password(old_password),
        sealed_new_password=seal_password("NewPass@2025"),
    )

    # 1) 响应语义：改密成功即「需重新登录」，不含任何 token
    assert result == {"success": True, "relogin": True}
    assert "tokens" not in result
    assert "accessToken" not in result

    # 2) token_version 自增（3 → 4）：旧 access 的 tv=3 之后鉴权必然落后被拒（立即失效）
    refreshed = await session.get(Account, account.id)
    assert refreshed.token_version == 4

    # 3) server_salt / password_verifier 真实更新（换了新盐，慢哈希随之不同）
    assert refreshed.server_salt != old_server_salt
    assert refreshed.password_verifier != old_password_verifier

    # 4) refresh 白名单被 DEL 清空：两台设备的旧 refresh 续签都将 SISMEMBER 落空
    assert await fake_redis.exists(_whitelist_key(account.id)) == 0

    # 5) tokenver 缓存被写穿刷新为新值 4（鉴权读缓存即拿到新 version，不依赖 TTL）
    assert await fake_redis.get(_token_version_key(account.id)) == "4"


async def test_change_password_wrong_old_password_rejected(session, fake_redis):
    """旧密码不正确：抛 OldPasswordError，且不改库、不动 version、不清 refresh。"""
    account, _correct_old = await create_account(
        session, password="OldPass@2024", token_version=1
    )
    original_verifier = account.password_verifier
    await fake_redis.sadd(_whitelist_key(account.id), "jti-keep")

    with pytest.raises(OldPasswordError):
        await change_password(
            session=session,
            user_id=account.id,
            sealed_old_password=seal_password("WrongOldPass@0000"),
            sealed_new_password=seal_password("NewPass@2025"),
        )

    # 旧密码核验失败：账户不变、version 不变、refresh 白名单原封不动
    refreshed = await session.get(Account, account.id)
    assert refreshed.token_version == 1
    assert refreshed.password_verifier == original_verifier
    assert await fake_redis.sismember(_whitelist_key(account.id), "jti-keep")


async def test_change_password_same_password_rejected(session, fake_redis):
    """新密码与旧密码相同：抛 SamePasswordError，且不改库、不动 version。"""
    account, old_password = await create_account(
        session, password="SamePass@2024", token_version=2
    )

    with pytest.raises(SamePasswordError):
        await change_password(
            session=session,
            user_id=account.id,
            sealed_old_password=seal_password(old_password),
            # 新密码与旧相同 → 服务端用当前盐二次哈希后等于库里值 → 判为未改
            sealed_new_password=seal_password("SamePass@2024"),
        )

    refreshed = await session.get(Account, account.id)
    assert refreshed.token_version == 2


async def test_change_password_account_not_found(session, fake_redis):
    """userId 对应账户不存在（被删 / id 失效）：按登录态失效处理，抛 TokenInvalidError。"""
    with pytest.raises(TokenInvalidError):
        await change_password(
            session=session,
            user_id=999_999,  # 库里不存在
            sealed_old_password=seal_password("AnyPass@2024"),
            sealed_new_password=seal_password("NewPass@2025"),
        )
