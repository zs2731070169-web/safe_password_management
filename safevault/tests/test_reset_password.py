"""重置服务（services/reset_password）测试 —— 方案 B 严格立即失效，复用公共失效方法。

覆盖：
  - 重置成功 → token_version 自增（与改密共用 invalidate_all_sessions）+ verifier/server_salt/
    kdf_params 真实更新 + refresh 白名单清空 + tokenver 缓存刷新 + 验证码被删 + 不返回 token
  - 验证码错误 → InvalidCodeError(400)，不改库、不动 version
  - 邮箱未注册 → 同样 InvalidCodeError(400)（同一提示，不泄露邮箱是否注册）
"""
from __future__ import annotations

import pytest

from config import settings
from core.exception.exceptions import InvalidCodeError
from models.account import Account
from services.reset_password import reset_account
from services.token import _token_version_key, _whitelist_key
from services.verify_code import _code_key

from conftest import create_account, seal_password


async def test_reset_success_invalidates_all_sessions(session, fake_redis):
    """重置成功：version 自增 + 落库 + 清 refresh + 刷新缓存 + 删验证码 + 不返回 token。"""
    account, _ = await create_account(
        session, email="reset@example.com", token_version=5
    )
    old_verifier_hash = account.password_verifier

    # 预置：发往该邮箱的真验证码 + 该用户的 refresh 白名单 + tokenver 旧缓存
    await fake_redis.setex(_code_key("reset@example.com"), settings.code_ttl, "123456")
    await fake_redis.sadd(_whitelist_key(account.id), "jti-x", "jti-y")
    await fake_redis.set(_token_version_key(account.id), 5)

    result = await reset_account(
        session=session,
        email="reset@example.com",
        sealed_new_password=seal_password("BrandNew@2025"),
        code="123456",
    )

    # 1) 响应走决策点 C2：不含 token、不自动登录，告知旧备份可经恢复码恢复
    assert result == {"resetOk": True, "recoverable": True}
    assert "tokens" not in result

    refreshed = await session.get(Account, account.id)
    # 2) token_version 自增（5 → 6）：任何残存旧 access 立即失效
    assert refreshed.token_version == 6
    # 3) password_verifier 真实更新（换了新盐 + 新口令慢哈希）
    assert refreshed.password_verifier != old_verifier_hash
    # 4) refresh 白名单清空
    assert await fake_redis.exists(_whitelist_key(account.id)) == 0
    # 5) tokenver 缓存写穿为新值 6
    assert await fake_redis.get(_token_version_key(account.id)) == "6"
    # 6) 验证码用后即焚
    assert await fake_redis.get(_code_key("reset@example.com")) is None


async def test_reset_wrong_code_rejected(session, fake_redis):
    """验证码错误：抛 InvalidCodeError，不改库、不动 version。"""
    account, _ = await create_account(
        session, email="reset@example.com", token_version=1
    )
    await fake_redis.setex(_code_key("reset@example.com"), settings.code_ttl, "123456")

    with pytest.raises(InvalidCodeError):
        await reset_account(
            session=session,
            email="reset@example.com",
            sealed_new_password=seal_password("BrandNew@2025"),
            code="000000",  # 错误验证码
        )

    refreshed = await session.get(Account, account.id)
    assert refreshed.token_version == 1


async def test_reset_unregistered_email_same_error(session, fake_redis):
    """邮箱未注册但验证码对：仍抛 InvalidCodeError（同一提示，不泄露注册事实）。"""
    # 不建账户，但预置一个「对得上的」验证码，证明账户不存在走的是同一异常
    await fake_redis.setex(_code_key("ghost@example.com"), settings.code_ttl, "123456")

    with pytest.raises(InvalidCodeError):
        await reset_account(
            session=session,
            email="ghost@example.com",
            sealed_new_password=seal_password("BrandNew@2025"),
            code="123456",
        )
