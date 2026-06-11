"""Token 服务（对齐时序图「🎫 Token 服务」组件）。

职责：签发 access（短时效）/ refresh（长时效）JWT，并把 refresh token 写入
Redis 白名单 `refresh:{userId}`（SADD）。续签（§4）时据白名单校验是否仍有效、轮转作废。

设计要点：
  - 对称 HS256，access / refresh 共用 settings.jwt_secret。
  - 用 `type` 声明 token 类型（access / refresh），校验时强制区分，防止把 refresh 当 access 用。
  - refresh 的 `jti`（唯一标识）即写入白名单集合的成员：续签时 SISMEMBER 判在不在、SREM 轮转作废，
    与时序图 §4「SADD / SISMEMBER / SREM refresh:{userId}」一致；
    存 jti 而非整段 token，集合更小、轮转更精确。

令牌版本号（token_version）—— 方案 B 严格立即失效：
  - access token 的 payload 携带 `tv`（签发当刻账户的 token_version）。
  - 每次 access 鉴权（见 api/deps.py）比对「token 里的 tv」与「账户当前 token_version」，
    不一致即拒（统一 TokenInvalidError 401）。
  - 改密 / 重置成功时调用 invalidate_all_sessions：token_version 自增（旧 access 因 tv 落后立即失效，
    零残留窗口）+ DEL refresh 白名单（其它设备 refresh 续签落空）。
  - version 校验为高频读，缓存到 Redis(tokenver:{userId}) 降低 DB 压力；自增时同步刷新缓存，
    不依赖 TTL 保证一致性（缓存只是加速，写穿策略：先改库、再覆盖缓存）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from client.redis_client import get_redis
from core.exception.exceptions import TokenInvalidError
from models.account import Account


def _whitelist_key(user_id: int) -> str:
    """refresh token 白名单的 Redis key，与时序图 refresh:{userId} 一致。"""
    return f"refresh:{user_id}"


def _token_version_key(user_id: int) -> str:
    """token_version 缓存的 Redis key，与 refresh:{userId} 命名风格一致。"""
    return f"tokenver:{user_id}"


def _now() -> datetime:
    """统一取 UTC 当前时间，JWT 时间声明用 UTC，避免时区歧义。"""
    return datetime.now(timezone.utc)


def _encode(payload: dict) -> str:
    """用配置的密钥与算法签发 JWT。"""
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _create_access_token(user_id: int, token_version: int) -> str:
    """签发 access token（短时效，默认 15min），payload 携带当刻 token_version(tv)。

    :param user_id: 账户 id（即 userId）
    :param token_version: 签发当刻账户的 token_version，写入 payload 供鉴权比对
    """
    now = _now()
    payload = {
        "sub": str(user_id),          # 主体：账户 id
        "type": "access",
        "tv": token_version,          # 令牌版本号：鉴权时与账户当前 token_version 比对
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_ttl_minutes),
    }
    return _encode(payload)


def _create_refresh_token(user_id: int, jti: str) -> str:
    """签发 refresh token（长时效，默认 30d），携带 jti 供白名单管理。"""
    now = _now()
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "jti": jti,                   # 唯一标识，即白名单成员
        "iat": now,
        "exp": now + timedelta(days=settings.refresh_token_ttl_days),
    }
    return _encode(payload)


async def issue_token_pair(user_id: int, token_version: int) -> dict[str, str]:
    """签发 access + refresh，并把 refresh 的 jti 写入 Redis 白名单。

    对齐时序图 §2 步骤 6：Token 服务签发 access(15min)+refresh(30d)，
    Token→Cache SADD 白名单 refresh:{userId}。access 的 payload 内嵌 token_version(tv)。

    :param user_id: 账户主键（即 userId）
    :param token_version: 签发当刻账户的 token_version（由调用方从账户实体或缓存取得）
    :returns: {"accessToken": ..., "refreshToken": ...}
    """
    jti = uuid.uuid4().hex
    access_token = _create_access_token(user_id, token_version)
    refresh_token = _create_refresh_token(user_id, jti)

    redis = get_redis()
    # SADD 白名单成员（jti）；并给集合设过期，与 refresh 有效期对齐，闲置自动回收。
    pipe = redis.pipeline()
    await pipe.sadd(_whitelist_key(user_id), jti)
    await pipe.expire(_whitelist_key(user_id), settings.refresh_token_ttl_days * 86400)
    await pipe.execute()

    return {"accessToken": access_token, "refreshToken": refresh_token}


def decode_access_token(token: str) -> tuple[int, int]:
    """校验 access token 并返回 (userId, tokenVersion)，供鉴权依赖使用（§5 改密等）。

    与 rotate_refresh_token 的校验风格一致（先验签、强制 type）。区别：这里校验 **access**，
    且**不在此查白名单 / 比对 version**——本函数只负责「无状态校验签名 + 取出 sub/tv」，
    token_version 的有状态比对放在调用方（api/deps.get_current_user_id），那里能拿到账户当前
    version（经 Redis 缓存）。这样既复用 verify 风格，又把「需要 IO 的比对」与「纯解码」分层。

      1) jwt.decode 校验签名与有效期；过期 / 签名错误 / 篡改 / 格式非法 → TokenInvalidError(401)
      2) 强制 type == "access"，杜绝拿 refresh 当 access 用
      3) 取 sub→int、tv→int 返回；缺字段 / 类型异常一律视为非法 token → 401
         （老 access 无 tv：KeyError 被收敛为 401，迫使其重新登录，符合方案 B 立即失效语义）

    :param token: 客户端持有的 access token（JWT 文本，已去除 "Bearer " 前缀）
    :returns: (userId, tokenVersion) —— token 主体携带的 userId 与签发当刻 version
    :raises TokenInvalidError: 签名 / 有效期非法、类型不符、或缺字段（统一 401）
    """
    # 1) 验签 + 校验有效期：过期 / 签名错误 / 格式错误统一收敛为 401
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError as exc:
        # access 已过期：客户端应据 401 触发 §4 续签（用 refresh 换新 access）后重试
        raise TokenInvalidError("登录态已过期，请重新登录") from exc
    except jwt.InvalidTokenError as exc:
        # 涵盖签名错误 / 篡改 / 格式非法等所有 PyJWT 校验失败
        raise TokenInvalidError("登录态无效，请重新登录") from exc

    # 2) 类型强校验：只接受 access，杜绝用 refresh token 冒充 access 访问受保护接口
    if payload.get("type") != "access":
        raise TokenInvalidError("登录态无效，请重新登录")

    # 3) 取 userId / tv；字段缺失或类型转换异常都视为非法 token → 401。
    #    缺 tv（迁移前签发的老 access）走 KeyError → 401：与方案 B「自增即失效」一致。
    try:
        return int(payload["sub"]), int(payload["tv"])
    except (KeyError, ValueError, TypeError) as exc:
        raise TokenInvalidError("登录态无效，请重新登录") from exc


async def get_account_token_version(session: AsyncSession, user_id: int) -> int | None:
    """取账户当前 token_version：优先读 Redis 缓存，未命中回库读一次并回填（旁路缓存）。

    鉴权高频调用，故先走缓存降低 DB 压力。缓存未命中时回库；账户不存在（被删 / id 失效）返回
    None，由调用方按登录态失效处理（401），并**不**回填缓存（避免缓存穿透写入无意义值）。

    缓存一致性：改密 / 重置自增 version 时由 bump_token_version 主动覆盖缓存（写穿），故此处
    读到的缓存值与库一致；TTL 仅作兜底回收，不承担一致性职责。

    :param session: 异步数据库会话（只读）
    :param user_id: 账户主键（即 userId）
    :returns: 账户当前 token_version；账户不存在返回 None
    """
    redis = get_redis()
    cached = await redis.get(_token_version_key(user_id))
    if cached is not None:
        # decode_responses=True，缓存值为 str；理论只由本模块写入数字，仍兜底 int 转换。
        try:
            return int(cached)
        except ValueError:
            # 脏值（理论不会出现）：忽略缓存、回库重读，下方会以库值覆盖修复缓存。
            pass

    version = await session.scalar(
        select(Account.token_version).where(Account.id == user_id)
    )
    if version is None:
        # 账户不存在：不回填缓存，交由调用方判 401。
        return None

    # 回填缓存（旁路缓存 read-through 的回写步骤），后续鉴权直接命中。
    await redis.set(
        _token_version_key(user_id),
        version,
        ex=settings.token_version_cache_ttl,
    )
    return version


async def _cache_token_version(user_id: int, token_version: int) -> None:
    """把账户的 token_version 写入 / 覆盖 Redis 缓存（写穿，自增后同步刷新用）。"""
    redis = get_redis()
    await redis.set(
        _token_version_key(user_id),
        token_version,
        ex=settings.token_version_cache_ttl,
    )


async def revoke_all_refresh_tokens(user_id: int) -> None:
    """吊销该用户的**全部** refresh token（DEL 白名单集合），强制其所有设备重新登录。

    对齐时序图 §5「吊销该用户其它 refresh token」：DEL refresh:{userId} 一次性清空集合内
    所有 jti，此后任何旧 refresh 续签时 SISMEMBER 必然落空 → §4 返回 401「请重新登录」。

    注意：本函数只清 refresh 白名单，不动 token_version。改密 / 重置请调用
    invalidate_all_sessions（同时自增 version 使旧 access 立即失效 + 清 refresh），不要单独
    调本函数，否则旧 access 在其剩余有效期内仍可用（方案 B 要求零残留窗口）。

    :param user_id: 账户主键（即 userId）
    """
    redis = get_redis()
    await redis.delete(_whitelist_key(user_id))


async def revoke_single_refresh_token(refresh_token: str, user_id: int) -> None:
    """退出登录：吊销**单个** refresh token（SREM 其 jti），不动 token_version，幂等且对登出友好。

    对齐时序图 §7 退出登录：客户端带 access（已由 get_current_user_id 鉴权，传入其 userId）与待吊销的
    refreshToken 调 POST /auth/logout。本函数只走 Token 服务 + Redis（不连用户库）：
      1) 验签 refresh + 强制 type == "refresh" + 取出 sub / jti；
      2) 归属校验 sub == user_id（防止 A 用自己的 access 去登出 B 的会话）；
      3) SREM refresh:{userId} 移除该 jti，即时失效该单个会话。

    与 §5 改密 / §6 重置的关键区别：logout **只删这一个 refresh、不自增 token_version**——退出当前
    设备无需让 access 立即失效（access 短时效，自然过期即可），更不应波及其它设备会话。故**不**调用
    invalidate_all_sessions / revoke_all_refresh_tokens。

    幂等且对登出友好（与 rotate_refresh_token「失败即 401」刻意相反）：登出语义下 refresh 本就要失效，
    故 refresh 验签失败 / 过期 / 缺字段 / 类型不符 / 归属不符 / jti 不在白名单 等任何情况一律**不抛错**，
    静默视为「已登出成功」直接返回——避免「access 仍有效但 refresh 已过期」时反而无法登出。

    :param refresh_token: 客户端待吊销的 refresh token（JWT 文本）
    :param user_id: 已由 access token 鉴权得到的当前登录用户 userId
    """
    # 1) 验签 + 校验有效期：签名错误 / 过期（ExpiredSignatureError 亦属 InvalidTokenError）/ 篡改 /
    #    格式非法 —— refresh 本已不可用，登出直接视为成功，静默返回（不抛 401）。
    try:
        payload = jwt.decode(
            refresh_token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.InvalidTokenError:
        return

    # 2) 类型 + 归属校验：非 refresh、缺字段、或不属于当前已鉴权用户 → 静默放过，
    #    既不报错也不去动他人白名单（拒绝越权登出别人的会话）。
    if payload.get("type") != "refresh":
        return
    try:
        token_user_id = int(payload["sub"])
        jti = payload["jti"]
    except (KeyError, ValueError, TypeError):
        return
    if token_user_id != user_id:
        return

    # 3) SREM 移除该单个 jti（jti 不在集合时 SREM 无副作用，天然幂等）；不动 token_version。
    redis = get_redis()
    await redis.srem(_whitelist_key(user_id), jti)


async def invalidate_all_sessions(session: AsyncSession, account: Account) -> int:
    """使该账户所有会话立即失效（方案 B 严格立即失效）：自增 token_version + 清 refresh 白名单。

    改密（§5）与重置（§6）成功后**共用**此一处实现，避免「自增 version + 清 refresh + 同步缓存」
    逻辑在两处漂移。执行顺序（写穿）：
      1) account.token_version += 1 并 flush → 旧 access 携带的 tv 落后于新值，下一次鉴权即被拒
         （立即失效，零残留窗口）。直接改已加载 ORM 实体属性，UPDATE 随当前事务提交。
      2) 覆盖 Redis 缓存 tokenver:{userId} 为新值（先改库、再写缓存的写穿次序，避免读到旧缓存）。
      3) DEL refresh:{userId} 清空白名单 → 其它设备的旧 refresh 续签时 SISMEMBER 落空 → 401。

    :param session: 异步数据库会话（事务化，调用方负责提交）
    :param account: 已加载的账户 ORM 实体（须可写，本函数会改其 token_version）
    :returns: 自增后的新 token_version（调用方一般无需使用；返回便于测试断言）
    """
    # 1) 自增 token_version 并 flush，使旧 access 立即失效
    account.token_version = account.token_version + 1
    await session.flush()
    new_version = account.token_version

    # 2) 写穿缓存：覆盖为新 version（先库后缓存，确保后续鉴权读到的是新值）
    await _cache_token_version(account.id, new_version)

    # 3) 清空 refresh 白名单：其它设备旧 refresh 立即失效
    await revoke_all_refresh_tokens(account.id)

    return new_version


async def rotate_refresh_token(refresh_token: str) -> dict[str, str]:
    """用 refresh token 换新一对（access + refresh），并轮转作废旧 refresh。

    对齐时序图 §4 token 静默续签：
      1) 校验签名与有效期（jwt.decode）；非法 / 过期 → 401「请重新登录」
      2) 强制 type == "refresh"，防止拿 access 冒充 refresh
      3) SISMEMBER 白名单 refresh:{userId} 判 jti 是否仍有效；
         不在（已吊销 / 轮转 / 被盗用）→ 401「请重新登录」
      4) SREM 旧 jti（轮转作废，旧 refresh 用后即失效，降低泄露风险）
      5) 读账户当前 token_version（经缓存），把它写入新 access 的 tv；账户不存在 → 401
      6) issue_token_pair 签发新 access + 新 refresh 并 SADD 新 jti（复用既有签发逻辑）
      7) 返回新 token 对

    校验顺序刻意「先验签再查白名单」：签名 / 有效期非法的请求不必打 Redis，
    避免无效签名也消耗一次 SISMEMBER。jti 为服务端签发的随机值，比对无需恒定时间。

    续签拿当前 token_version 写进新 access：改密 / 重置自增 version 后会 DEL refresh 白名单，
    旧 refresh 在第 3 步即被拒，正常不会走到第 5 步；但仍读当前 version 以保证新签发的 access
    永远携带最新 tv，逻辑自洽。

    :param refresh_token: 客户端持有的 refresh token（JWT 文本）
    :returns: {"accessToken": ..., "refreshToken": ...}（即 issue_token_pair 返回）
    :raises TokenInvalidError: 签名 / 有效期非法、类型不符、缺字段、不在白名单、或账户不存在（统一 401）
    """
    # 1) 验签 + 校验有效期：过期 / 签名错误 / 格式错误统一收敛为 401「请重新登录」
    try:
        payload = jwt.decode(
            refresh_token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError as exc:
        # refresh 已过期：客户端须重新登录获取新对
        raise TokenInvalidError("请重新登录") from exc
    except jwt.InvalidTokenError as exc:
        # 涵盖签名错误 / 篡改 / 格式非法等所有 PyJWT 校验失败
        raise TokenInvalidError("请重新登录") from exc

    # 2) 类型强校验：只接受 refresh，杜绝用 access token 来续签
    if payload.get("type") != "refresh":
        raise TokenInvalidError("请重新登录")

    # 取 userId / jti；任一字段缺失或类型转换异常都视为非法 token → 401
    try:
        user_id = int(payload["sub"])
        jti = payload["jti"]
    except (KeyError, ValueError, TypeError) as exc:
        raise TokenInvalidError("请重新登录") from exc

    redis = get_redis()
    # 3) SISMEMBER 白名单：jti 不在集合（已被 SREM 轮转 / DEL 吊销 / 从未签发）→ 401
    in_whitelist = await redis.sismember(_whitelist_key(user_id), jti)
    if not in_whitelist:
        raise TokenInvalidError("请重新登录")

    # 4) SREM 旧 jti：轮转作废，旧 refresh 立即失效（再次拿旧 refresh 续签将在第 3 步被拒）
    await redis.srem(_whitelist_key(user_id), jti)

    # 5) 读账户当前 token_version（经缓存）；账户不存在 → 401。续签不依赖请求中的 session，
    #    单独开一个只读会话取 version（rotate 在 §4 不经认证服务、不连库的设计下，此处为读
    #    version 必需的最小 DB 访问，命中缓存时通常不实际触库）。
    from client.db_client import get_session_factory  # 局部 import 避免与 db_client 形成循环

    factory = get_session_factory()
    async with factory() as session:
        token_version = await get_account_token_version(session, user_id)
    if token_version is None:
        raise TokenInvalidError("请重新登录")

    # 6) 复用 issue_token_pair 签发新对并 SADD 新 jti，新 access 携带最新 tv
    return await issue_token_pair(user_id, token_version)
