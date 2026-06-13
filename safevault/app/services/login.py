"""登录解锁业务编排（对齐时序图 §3 认证服务部分，认证已改为非对称封装上送密码）。

严格按步骤推进（限流由路由层先行处理，此处不重复）：
  1. decrypt_sealed 解封 sealed_password → 得明文密码（封装非法抛 SealDecryptError 400）
  2. GET fail:{email} 读失败次数 → 计数 >= 阈值（默认 5）抛 AccountLockedError(423)
  3. SELECT server_salt, password_verifier BY email 定位账户
  4. 邮箱不存在 / 口令不符 / 账户停用 → INCR fail:{email}（TTL 15min）抛 AuthFailedError(401)
  5. 验证通过 → DEL fail:{email}（清零）→ 签发 access+refresh → 返回 { tokens, userId }

提速方案：客户端用服务端公钥把明文密码非对称封装上送，后端解封得明文后，叠加该账户已存的
server_salt 用与注册**完全相同**的服务端慢哈希（services/verifier.hash_password）重算，再与库里
password_verifier 做恒定时间比较。相比旧零知识方案，客户端不再本地跑 PBKDF2 派生 verifier、也不再
先拉 kdf-params，登录认证段大幅提速；保险库的零知识加密与 DataKey 派生仍全在客户端本地。

安全取舍:
  - 不区分「邮箱不存在」「口令不符」「账户停用」,对外统一 401「邮箱或密码不正确」,
    避免被用于探测某邮箱是否注册;三种情形都计入 fail 计数,统一暴力破解防护。
  - 即便邮箱不存在,也走一次相同的慢哈希再比对(对一份哑数据),让响应耗时与「账户存在但
    密码错」基本一致,削弱据响应时间判断邮箱是否注册的时序侧信道。
"""
from __future__ import annotations

import secrets
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from core.exception.exceptions import AccountLockedError, AuthFailedError
from client.redis_client import get_redis
from models.account import Account
from services.token import issue_token_pair
from services.verifier import generate_server_salt, hash_password
from services.seal import decrypt_sealed

# 邮箱不存在时用于「假比对」的哑账户盐:进程启动时随机生成一次即可。
# 真实账户永远比不中它,仅用于消耗与真实路径相当的慢哈希耗时,抹平时序差异。
_DUMMY_SERVER_SALT = generate_server_salt()


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
    sealed_password: str,
) -> dict[str, Any]:
    """登录解锁主流程,返回 { tokens, userId }。

    :param session: 异步数据库会话(由路由依赖注入,只读,无写操作)
    :param email: 已归一化(小写、去空格)邮箱
    :param sealed_password: 客户端用服务端公钥封装的明文密码(base64,见 services/seal.py)
    :returns: {"tokens": {"accessToken", "refreshToken"}, "userId": int}
    :raises SealDecryptError: 密码封装无效(400)
    :raises AccountLockedError: 失败次数达到阈值,账户临时锁定(423)
    :raises AuthFailedError: 邮箱不存在 / 口令不符 / 账户停用(401)
    """
    redis = get_redis()

    # 步骤 1:解封得明文密码(封装非法 / 校验不过 → SealDecryptError 400)
    password = decrypt_sealed(sealed_password)

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

    # 步骤 4 的判定:邮箱不存在 / 账户停用 / 口令不符 → 统一计 fail 并抛 401
    if account is None:
        # 邮箱不存在:仍做一次假哈希消耗等量慢哈希耗时,抹平时序侧信道,再统一失败处理。
        hash_password(password, _DUMMY_SERVER_SALT)
        await _record_failure(email)
        raise AuthFailedError("邮箱或密码不正确")

    user_id, server_salt, stored_verifier, status, token_version = account

    # 用注册时的同款服务端慢哈希叠加该账户已存的 server_salt 重算,再恒定时间比较。
    computed = hash_password(password, server_salt)
    password_ok = secrets.compare_digest(computed, stored_verifier)

    # status != 1(停用)与口令不符一律按校验失败处理:都计 fail、都抛统一 401。
    # 即便口令对,只要账户停用也拒绝(避免向停用账户签发 token)。
    if not password_ok or status != 1:
        await _record_failure(email)
        raise AuthFailedError("邮箱或密码不正确")

    # 步骤 5:校验通过 → DEL fail:{email} 清零失败计数 → 签发 token（access 携带当前 token_version）
    await redis.delete(_fail_key(email))
    tokens = await issue_token_pair(user_id, token_version)

    return {"tokens": tokens, "userId": user_id}
