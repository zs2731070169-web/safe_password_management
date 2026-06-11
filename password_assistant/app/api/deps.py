"""路由层共享依赖（FastAPI Depends）。

集中放置跨路由复用的依赖项。首个依赖是访问令牌鉴权 get_current_user_id：
受保护接口（如 §5 改密）通过 `user_id: int = Depends(get_current_user_id)` 即可拿到
当前登录用户的 userId，无需在每个端点重复解析 Authorization 头与校验 token。

令牌版本号比对（方案 B 严格立即失效）：本依赖在验签取出 (userId, tv) 后，再比对账户当前
token_version。改密 / 重置自增 version 后，旧 access 的 tv 落后 → 此处比对失败立即拒绝（401），
旧 access 零残留窗口。version 经 Redis 缓存读取（见 services/token.get_account_token_version），
高频鉴权不每次触库。
"""
from __future__ import annotations

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from client.db_client import get_session
from core.exception.exceptions import TokenInvalidError
from services.token import decode_access_token, get_account_token_version

# HTTPBearer(auto_error=False)：不让 FastAPI 在缺失 / 格式错时自行抛 403，而是返回 None，
# 由本依赖统一收敛为业务异常 TokenInvalidError(401)，与时序图 §5「无效→401」及项目既有
# 401 文案风格一致（避免出现 FastAPI 默认的英文 403 "Not authenticated"）。
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> int:
    """从 Authorization: Bearer <access> 头解析并校验 access token，比对 token_version 后返回 userId。

    对齐时序图 §5 网关侧「校验 access token 未过期，无效→401」，并叠加方案 B 的 version 闸：
      - 缺失 Authorization 头 / 非 Bearer 方案 → TokenInvalidError(401)
      - token 签名 / 有效期非法、类型不符、缺字段（含老 access 无 tv）→ TokenInvalidError(401)
      - token 里的 tv ≠ 账户当前 token_version（改密 / 重置已自增）→ TokenInvalidError(401)，
        旧 access 立即失效
      - 账户不存在（被删 / id 失效）→ TokenInvalidError(401)
      - 全部通过 → 返回 userId

    与业务路由共享同一个被 FastAPI 缓存的 get_session 依赖实例（同一请求同一事务），故 version
    比对走的是当前事务的会话；命中 Redis 缓存时通常不实际触库。

    :param credentials: HTTPBearer 解析出的凭据（缺失 / 格式错时为 None）
    :param session: 异步数据库会话（与业务路由共享同一实例，用于读 token_version 兜底回库）
    :returns: 当前登录用户的 userId
    :raises TokenInvalidError: 凭据缺失 / 格式错 / 校验失败 / version 不符 / 账户不存在（统一 401）
    """
    # 缺失头或方案不是 bearer：HTTPBearer 已校验 scheme，但 auto_error=False 下缺失时为 None
    if credentials is None or not credentials.credentials:
        raise TokenInvalidError("登录态无效，请重新登录")

    # 1) 无状态校验签名 + 类型 + 取 sub/tv；任一失败抛 TokenInvalidError(401)
    user_id, token_version = decode_access_token(credentials.credentials)

    # 2) 有状态比对 token_version（经 Redis 缓存）：账户不存在或 version 不符一律 401。
    current_version = await get_account_token_version(session, user_id)
    if current_version is None or current_version != token_version:
        # version 不一致 = 改密 / 重置后自增过，旧 access 立即失效；账户不存在同样按失效处理。
        raise TokenInvalidError("登录态已失效，请重新登录")

    return user_id
