"""token_version 鉴权链路测试（services/token + api/deps）—— 方案 B 严格立即失效。

覆盖：
  - access 携带签发当刻 tv；deps 比对账户当前 token_version 一致 → 放行返回 userId
  - 改密 / 重置自增 version 后，旧 access（tv 落后）→ 鉴权立即 401（立即失效，零残留窗口）
  - 缺 tv 的老 access → 401（迁移前签发的 access 不被兼容）
  - 账户不存在 → 401
  - invalidate_all_sessions：自增 version + 写穿 tokenver 缓存 + DEL refresh 白名单
  - get_account_token_version：缓存命中不触库；未命中回库并回填
"""
from __future__ import annotations

import pytest
from fastapi.security import HTTPAuthorizationCredentials

from api.validation import get_current_user_id
from core.exception.exceptions import TokenInvalidError
from services.token import (
    _create_access_token,
    _token_version_key,
    _whitelist_key,
    get_account_token_version,
    invalidate_all_sessions,
    issue_token_pair,
)

from conftest import create_account


def _bearer(token: str) -> HTTPAuthorizationCredentials:
    """包成 deps 期望的 HTTPBearer 凭据对象。"""
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


async def test_valid_access_passes_auth(session, fake_redis):
    """tv 与账户当前 token_version 一致：鉴权通过，返回 userId。"""
    account, _ = await create_account(session, token_version=5)
    access = _create_access_token(account.id, token_version=5)

    user_id = await get_current_user_id(credentials=_bearer(access), session=session)
    assert user_id == account.id


async def test_stale_access_rejected_after_version_bump(session, fake_redis):
    """改密/重置自增 version 后，旧 access（tv 落后）立即被拒（核心：零残留窗口）。"""
    account, _ = await create_account(session, token_version=1)
    # 旧 access 在 version=1 时签发
    stale_access = _create_access_token(account.id, token_version=1)

    # 模拟改密/重置：自增 version + 写穿缓存 + 清 refresh
    new_version = await invalidate_all_sessions(session, account)
    assert new_version == 2

    # 旧 access 立即失效：tv=1 ≠ 当前 2 → 401
    with pytest.raises(TokenInvalidError):
        await get_current_user_id(credentials=_bearer(stale_access), session=session)


async def test_access_without_tv_rejected(session, fake_redis):
    """缺 tv 的老 access（迁移前签发）→ 401，迫使重新登录。"""
    import jwt
    from datetime import datetime, timedelta, timezone

    from config import settings

    account, _ = await create_account(session, token_version=1)
    now = datetime.now(timezone.utc)
    # 手工签一个不含 tv 的 access，模拟迁移前老 token
    legacy_payload = {
        "sub": str(account.id),
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=15),
    }
    legacy_access = jwt.encode(
        legacy_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm
    )

    with pytest.raises(TokenInvalidError):
        await get_current_user_id(credentials=_bearer(legacy_access), session=session)


async def test_missing_credentials_rejected(session, fake_redis):
    """缺失 Authorization 头（credentials=None）→ 401。"""
    with pytest.raises(TokenInvalidError):
        await get_current_user_id(credentials=None, session=session)


async def test_account_not_found_rejected(session, fake_redis):
    """账户不存在（version 读出 None）→ 401。"""
    access = _create_access_token(999_999, token_version=1)
    with pytest.raises(TokenInvalidError):
        await get_current_user_id(credentials=_bearer(access), session=session)


async def test_invalidate_all_sessions_effects(session, fake_redis):
    """invalidate_all_sessions：version 自增 + 缓存写穿为新值 + refresh 白名单被清空。"""
    account, _ = await create_account(session, token_version=7)
    await fake_redis.sadd(_whitelist_key(account.id), "jti-1", "jti-2")
    await fake_redis.set(_token_version_key(account.id), 7)

    new_version = await invalidate_all_sessions(session, account)

    assert new_version == 8
    assert account.token_version == 8
    # 缓存写穿为新值
    assert await fake_redis.get(_token_version_key(account.id)) == "8"
    # refresh 白名单被 DEL
    assert await fake_redis.exists(_whitelist_key(account.id)) == 0


async def test_get_account_token_version_cache_then_db(session, fake_redis):
    """token_version 读取：缓存命中直接返回；未命中回库并回填缓存。"""
    account, _ = await create_account(session, token_version=4)

    # 缓存未命中 → 回库读 4 并回填
    v1 = await get_account_token_version(session, account.id)
    assert v1 == 4
    assert await fake_redis.get(_token_version_key(account.id)) == "4"

    # 直接把缓存改为 99（库仍是 4）：证明命中缓存时不回库
    await fake_redis.set(_token_version_key(account.id), 99)
    v2 = await get_account_token_version(session, account.id)
    assert v2 == 99

    # 账户不存在：返回 None 且不回填缓存
    v_none = await get_account_token_version(session, 888_888)
    assert v_none is None
    assert await fake_redis.get(_token_version_key(888_888)) is None


async def test_issued_access_carries_current_version_and_whitelists_refresh(
    session, fake_redis
):
    """issue_token_pair：access 携带传入 version，refresh 的 jti 写入白名单。"""
    account, _ = await create_account(session, token_version=6)
    pair = await issue_token_pair(account.id, token_version=6)

    assert "accessToken" in pair and "refreshToken" in pair
    # 新签 access 的 tv=6 与账户一致 → 鉴权应放行
    user_id = await get_current_user_id(
        credentials=_bearer(pair["accessToken"]), session=session
    )
    assert user_id == account.id
    # 白名单非空（refresh jti 已 SADD）
    assert await fake_redis.scard(_whitelist_key(account.id)) == 1
