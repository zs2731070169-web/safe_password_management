"""登录解锁业务编排（对齐时序图 §3 认证服务部分）。

严格按时序图步骤推进（步骤号与图中 autonumber 对应；限流由路由层先行处理，此处不重复）：
  2. GET fail:{email} 读失败次数 → 计数 >= 阈值（默认 5）抛 AccountLockedError(423)
  3. SELECT server_salt, password_verifier BY email 定位账户
  4. 邮箱不存在 / 验证器不符 / 账户停用 → INCR fail:{email}（TTL 15min）抛 AuthFailedError(401)
  5. 验证通过 → DEL fail:{email}（清零）→ 签发 access+refresh → 返回 { tokens, userId }

零知识:请求体 `verifier` 是客户端本地用「明文密码 + 注册时 kdf_params」重算的同一个 verifier
（后端拿不到明文）。比对时取该账户已存的 server_salt,用与注册**完全相同**的服务端慢哈希
（services/verifier.hash_verifier）重算,再与库里 password_verifier 做恒定时间比较。

安全取舍:
  - 不区分「邮箱不存在」「验证器不符」「账户停用」,对外统一 401「邮箱或密码不正确」,
    避免被用于探测某邮箱是否注册;三种情形都计入 fail 计数,统一暴力破解防护。
  - 即便邮箱不存在,也走一次相同的慢哈希再比对(对一份哑数据),让响应耗时与「账户存在但
    密码错」基本一致,削弱据响应时间判断邮箱是否注册的时序侧信道。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from core.exception.exceptions import AccountLockedError, AuthFailedError
from client.redis_client import get_redis
from models.account import Account
from services.token import issue_token_pair
from services.verifier import generate_server_salt, hash_verifier

# 邮箱不存在时用于「假比对」的哑账户盐:进程启动时随机生成一次即可。
# 真实账户永远比不中它,仅用于消耗与真实路径相当的慢哈希耗时,抹平时序差异。
_DUMMY_SERVER_SALT = generate_server_salt()

# 伪 kdf_params 的默认配方:须与客户端 utils/kdf.js 的默认常量完全一致
# （algorithm / iterations / length），未注册邮箱据此返回的伪配方才与真实账户不可区分。
_KDF_ALGORITHM = "PBKDF2-SHA256"
_KDF_ITERATIONS = 600_000
_KDF_LENGTH = 32


def _pseudo_kdf_params(email: str) -> dict[str, Any]:
    """为未注册邮箱生成「确定性伪配方」,挡邮箱枚举。

    salt = HMAC-SHA256(jwt_secret, email) 取前 16 字节(与真实 client salt 等长)base64。
    同一邮箱恒定返回同一 salt(故攻击者无法据「salt 是否变化」判断邮箱是否注册);
    其余字段用客户端默认配方,使响应结构与真实账户完全一致。据此派生的 verifier
    永不匹配任何账户,登录照常 401。

    :param email: 已归一化邮箱
    :returns: 伪 kdf_params(结构同真实账户)
    """
    digest = hmac.new(
        settings.jwt_secret.encode("utf-8"),
        email.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    salt = base64.b64encode(digest[:16]).decode("ascii")
    return {
        "algorithm": _KDF_ALGORITHM,
        "salt": salt,
        "iterations": _KDF_ITERATIONS,
        "length": _KDF_LENGTH,
    }


async def get_login_kdf_params(session: AsyncSession, email: str) -> dict[str, Any]:
    """登录前取该邮箱的派生配方(供客户端本地重算 verifier)。

    邮箱已注册 → 返回库里真实 kdf_params;未注册 → 返回确定性伪配方(见 _pseudo_kdf_params),
    两种响应不可区分,杜绝据此枚举邮箱。salt 非机密,公开返回符合零知识 / SRP 惯例。

    :param session: 异步数据库会话(只读)
    :param email: 已归一化邮箱
    :returns: kdf_params(真实或伪造,结构一致)
    """
    stored = await session.scalar(
        select(Account.kdf_params).where(Account.email == email)
    )
    if stored is not None:
        return stored
    return _pseudo_kdf_params(email)


def _fail_key(email: str) -> str:
    """登录失败计数 Redis key,按邮箱维度(与时序图 fail:{email} 一致)。"""
    return f"fail:{email}"


async def _ensure_not_locked(email: str) -> None:
    """步骤 2:读 fail:{email},计数 >= 阈值即判定账户临时锁定,抛 AccountLockedError(423)。

    key 不存在(GET 返回 None)视为 0 次,放行。临时锁定只走 Redis 计数 + TTL,
    不落 account.status;TTL 过期计数消失即自动解锁。

    :param email: 已归一化邮箱
    :raises AccountLockedError: 失败次数达到阈值(423)
    """
    redis = get_redis()
    raw = await redis.get(_fail_key(email))
    # decode_responses=True,GET 返回 str;缺失为 None。非数字理论不会出现(只由 INCR 写),
    # 仍做兜底 int 转换以防脏数据。
    current = int(raw) if raw is not None else 0
    if current >= settings.login_fail_threshold:
        raise AccountLockedError("账户暂时锁定，请稍后")


async def _record_failure(email: str) -> None:
    """步骤 4 的副作用:INCR fail:{email} 并续期 TTL(失败即续期)。

    每次失败都重置 TTL(而非仅首次置 1 时设),使持续攻击期间锁定窗口始终保持新鲜——
    只要还在不停试错,计数就不会过期,锁定持续生效;一旦停手,TTL 到点自动清零解锁。
    用 pipeline 把 INCR + EXPIRE 打包成一次往返,风格与 token / rate_limit 一致。

    :param email: 已归一化邮箱
    """
    redis = get_redis()
    pipe = redis.pipeline()
    await pipe.incr(_fail_key(email))
    await pipe.expire(_fail_key(email), settings.login_fail_ttl)
    await pipe.execute()


async def login_account(
    session: AsyncSession,
    email: str,
    verifier: str,
) -> dict[str, Any]:
    """登录解锁主流程,返回 { tokens, userId }。

    :param session: 异步数据库会话(由路由依赖注入,只读,无写操作)
    :param email: 已归一化(小写、去空格)邮箱
    :param verifier: 客户端本地重算的密码验证器(base64,非明文)
    :returns: {"tokens": {"accessToken", "refreshToken"}, "userId": int}
    :raises AccountLockedError: 失败次数达到阈值,账户临时锁定(423)
    :raises AuthFailedError: 邮箱不存在 / 验证器不符 / 账户停用(401)
    """
    redis = get_redis()

    # 步骤 2:锁定判定(失败次数 >= 阈值直接 423,不再触库)
    await _ensure_not_locked(email)

    # 步骤 3:按邮箱取出 server_salt、password_verifier、status、id、token_version(只读)
    row = await session.execute(
        select(
            Account.id,
            Account.server_salt,
            Account.password_verifier,
            Account.status,
            Account.token_version,
        ).where(Account.email == email)
    )
    account = row.first()

    # 步骤 4 的判定:邮箱不存在 / 账户停用 / 验证器不符 → 统一计 fail 并抛 401
    if account is None:
        # 邮箱不存在:仍做一次假比对消耗等量慢哈希耗时,抹平时序侧信道,再统一失败处理。
        hash_verifier(verifier, _DUMMY_SERVER_SALT)
        await _record_failure(email)
        raise AuthFailedError("邮箱或密码不正确")

    user_id, server_salt, stored_verifier, status, token_version = account

    # 用注册时的同款服务端慢哈希叠加该账户已存的 server_salt 重算,再恒定时间比较。
    computed = hash_verifier(verifier, server_salt)
    verifier_ok = secrets.compare_digest(computed, stored_verifier)

    # status != 1(停用)与验证器不符一律按校验失败处理:都计 fail、都抛统一 401。
    # 即便验证器对,只要账户停用也拒绝(避免向停用账户签发 token)。
    if not verifier_ok or status != 1:
        await _record_failure(email)
        raise AuthFailedError("邮箱或密码不正确")

    # 步骤 5:校验通过 → DEL fail:{email} 清零失败计数 → 签发 token（access 携带当前 token_version）
    await redis.delete(_fail_key(email))
    tokens = await issue_token_pair(user_id, token_version)

    return {"tokens": tokens, "userId": user_id}
