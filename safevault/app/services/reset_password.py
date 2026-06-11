"""忘记密码重置业务编排（对齐时序图 §6 认证服务部分）。

适用场景：用户忘记密码、**无法登录**，仅凭「发往其邮箱的验证码」授权重置后端登录凭据。
与 §5 改密的区别：改密需先用 access token 鉴身份（已登录），重置则无 token、靠验证码授权。

严格按时序图 §6 步骤推进（步骤号与图中 autonumber 对应；限流由路由层先行处理，此处不重复）：
  1. 限流（IP 维度）——已在路由依赖 rate_limit("reset") 前置拦截，本编排不再处理。
  2. GET code:{email} 校验验证码 → 缺失 / 不符抛 InvalidCodeError(400「验证码错误或已过期」)。
  3. 按 email 查 account 取 user_id；账户不存在 → 同样抛 InvalidCodeError(400)，与验证码失败同一提示。
  4. 生成**新** server_salt → hash_verifier(新verifier, 新server_salt) → UPDATE password_verifier
     / server_salt / kdf_params BY email（kdf_params 也更新，因换了新 client salt）。
  5. DEL code:{email}（用后即焚，防验证码复用）。
  6. invalidate_all_sessions(account)（方案 B 严格立即失效，与 §5 改密共用同一公共方法）：
     token_version 自增（任何残存的旧 access 因 tv 落后**立即失效**）+ 同步 Redis 缓存 +
     DEL refresh:{userId} 清空白名单。重置场景用户本处于「无法登录」态、理论上无在用 access，
     但仍自增 version 以保证语义统一、零残留窗口，且与改密复用同一实现杜绝逻辑漂移。
  7. 决策点 C → 走 C2（恢复码包裹式密钥，key escrow）：返回 { resetOk: true, recoverable: true }，
     不签发 token、不自动登录。旧整库 blob **不再标记失效**——它仍可经恢复码解出 DataKey 后被新密码
     重新包裹，故无需清云备份。

零知识：请求体里的 `verifier` 已是「客户端用**新明文密码**本地派生」的产物（含新 client salt，
内嵌在 kdf_params 里），后端永不接触明文；落库前再叠加新的随机 server_salt 慢哈希一次，与注册
（§2）/ 登录（§3）/ 改密（§5）完全同构——杜绝算法漂移导致重置后登录比不中。

决策点 C（与零知识冲突的取舍）——本实现取 C2（恢复码包裹式密钥，key escrow）：
  包裹式密钥方案下，整库密文由随机 DataKey 加密，DataKey 被「密码」与「恢复码」各包裹一份独立存放
  （分别随 backup_blob 与 recovery_blob 存）。重置只换后端登录凭据，**旧整库 blob 无需作废**——客户端
  随后用恢复码 GET /backup/recovery-blob 解出 DataKey，再以新密码重新派生包裹密钥重新包裹、PUT /backup
  重传（整库密文本体不变，只换密码包裹层），旧云备份即被新密码可解。故本编排**不再把 backup_blob.valid
  置 0、不返回 cloudBackupCleared**，改返回 recoverable=true（语义：旧备份仍在、可经恢复码恢复）。
  注意：本编排只负责换登录凭据与吊销会话；DataKey 的恢复与重新包裹完全在客户端 + 备份服务完成，
  reset_account 不触达任何 blob 表，保持纯零知识、职责单一。

为何重置不自动登录：对齐图末「重置不自动登录 → 回登录页（§3）重新登录」。重置已 DEL 全部 refresh，
此处再签发 token 会与「全量吊销」语义自相矛盾；拿到合法会话的正当方式是用新密码走一次 §3 登录。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.exception.exceptions import InvalidCodeError
from client.redis_client import get_redis
from models.account import Account
from services.token import invalidate_all_sessions
# 验证码校验与 key 统一收敛在 services/verify_code.py，注册（§2）与重置（§6）共用同一实现
from services.verify_code import _code_key, verify_code
# 与注册 / 登录 / 改密共用同一套 server_salt 生成与 verifier 慢哈希实现，杜绝算法漂移
# （详见 services/verifier.py）。
from services.verifier import generate_server_salt, hash_verifier


async def reset_account(
    session: AsyncSession,
    email: str,
    verifier: str,
    kdf_params: dict[str, Any],
    code: str,
) -> dict[str, Any]:
    """忘记密码重置主流程，返回 { resetOk: True, recoverable: True }（走决策点 C2）。

    :param session: 异步数据库会话（由路由依赖注入，事务化，退出自动提交）
    :param email: 已归一化（小写、去空格）邮箱
    :param verifier: 客户端用新密码本地派生的新密码验证器（base64，非明文）
    :param kdf_params: 新的本地密钥派生配方（含新 client salt，后端仅透传存储）
    :param code: 邮箱验证码
    :returns: {"resetOk": True, "recoverable": True}
    :raises InvalidCodeError: 验证码缺失 / 不符，或邮箱未注册（统一 400「验证码错误或已过期」）
    """
    redis = get_redis()

    # 步骤 2：校验验证码（共享 services/verify_code.verify_code）
    await verify_code(email, code)

    # 步骤 3：按 email 取账户实体（需可写以做 UPDATE，故取整行 ORM 实体而非标量列）。
    # 账户不存在的处理：能走到这步必先收到过发往该邮箱的真验证码，邮箱枚举风险低；但仍与
    # 验证码失败用**同一提示**（不抛专门的「邮箱未注册」），避免泄露邮箱是否注册的事实。
    account = await session.scalar(select(Account).where(Account.email == email))
    if account is None:
        raise InvalidCodeError("验证码错误或已过期")

    # 步骤 4：生成新的 server_salt，对新 verifier 二次慢哈希后更新三列（含 kdf_params——换了新
    # client salt 必须一并更新，否则后续 §3 登录用旧 salt 重算 verifier 会比不中）。
    # 直接改已加载 ORM 实体属性 → SQLAlchemy 在 flush 时生成 UPDATE；事务由 get_session 收尾提交。
    server_salt = generate_server_salt()
    account.server_salt = server_salt
    account.password_verifier = hash_verifier(verifier, server_salt)
    account.kdf_params = kdf_params
    await session.flush()

    # 步骤 5：DEL code:{email}（用后即焚，防验证码复用）
    await redis.delete(_code_key(email))

    # 步骤 6：全量会话失效（方案 B，与 §5 改密共用 invalidate_all_sessions，避免逻辑漂移）——
    # token_version 自增使任何残存旧 access **立即失效** + 同步 Redis 缓存 + DEL 全部 refresh 白名单。
    # 重置场景用户本就处于「无法登录」态、通常无在用 access，仍自增 version 以统一语义、零残留窗口。
    # 重置**不**为当前会话重发新对：拿合法会话的正当方式是随后用新密码走一次 §3 登录
    # （前端 store 已据此串联 reset→login）。
    await invalidate_all_sessions(session, account)

    # 步骤 7：决策点 C → C2（恢复码包裹式密钥，key escrow）。旧整库 blob **不作废**——客户端随后用恢复码
    # GET /backup/recovery-blob 解出 DataKey、以新密码重新包裹并 PUT /backup 重传，旧云备份即被新密码可解。
    # 本编排不触达任何 blob 表（DataKey 恢复与重新包裹全在客户端 + 备份服务完成），保持纯零知识、职责单一；
    # 不签发 token、不自动登录。返回 recoverable=true 告知客户端「旧备份仍在、可经恢复码恢复」。
    return {"resetOk": True, "recoverable": True}
