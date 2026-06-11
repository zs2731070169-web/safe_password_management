"""修改账户密码业务编排（对齐时序图 §5 认证服务部分，方案 B 严格立即失效）。

前置：网关（本项目由 get_current_user_id 依赖承担，见 api/validation.py）已校验 access token，
解析出 userId、并比对 token_version 通过后才进入本编排。故这里不再处理 token 校验，只做
「旧密码核验 → 重算落库 → 全量会话失效」。

严格按时序图 §5 推进，并叠加两项安全增强（旧密码核验 + 立即失效）：
  1. 按 userId 取账户；取不到（账户已被删除 / id 失效）→ TokenInvalidError(401)，视为登录态失效。
  2. **旧密码核验**：对 old_verifier 叠加账户当前 server_salt 慢哈希，与库里 password_verifier
     做恒定时间比对（secrets.compare_digest）；不符抛 OldPasswordError(401「旧密码不正确」)。
     用恒定时间比较 + 复用同款慢哈希，杜绝据响应耗时 / 差异枚举旧密码（与登录 §3 同思路）。
  3. **新旧相同校验**：用账户当前 server_salt 对**新 verifier** 同款慢哈希，若结果等于库里
     password_verifier（即新旧密码派生同一 verifier）→ SamePasswordError(400「新密码不能与旧密码相同」)。
  4. 生成**新** server_salt → 对新 verifier 二次慢哈希 → UPDATE password_verifier / server_salt
     / kdf_params BY userId（直接改 ORM 对象属性，flush 生成 UPDATE）。
  5. invalidate_all_sessions：token_version 自增（旧 access **立即失效**，零残留窗口）+ 同步
     Redis 缓存 + DEL 全部 refresh 白名单（其它设备 refresh 续签落空）。改密 / 重置共用此公共方法。
  6. 返回 { success: True, relogin: True }——**不再签发 token**：方案 B 下含当前设备在内的全部
     会话已失效，客户端须清本地 token、用新密码重新登录（前端据此跳登录页）。

零知识：请求体里的 `verifier` / `old_verifier` 均是「客户端用明文密码本地派生」的产物（新
verifier 含新 client salt，内嵌在 kdf_params；old_verifier 用旧 kdf_params 派生）。后端永不接触
明文密码；落库前再叠加新的随机 server_salt 慢哈希一次，与注册 / 登录 / 重置完全同构。

幂等：改密成功后旧 access 因 token_version 自增立即失效，同一请求重复提交（带同一旧 access）
会在 get_current_user_id 处被判 401，天然防重复处理，无需额外幂等键。
"""
from __future__ import annotations

import logging
import secrets
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.exception.exceptions import (
    OldPasswordError,
    SamePasswordError,
    TokenInvalidError,
)
from models.account import Account
from services.token import invalidate_all_sessions
# 与注册 / 登录 / 重置共用同一套 server_salt 生成与 verifier 慢哈希实现，杜绝算法漂移
# （详见 services/verifier.py）。
from services.verifier import generate_server_salt, hash_verifier

logger = logging.getLogger("safevault.auth")


async def change_password(
    session: AsyncSession,
    user_id: int,
    old_verifier: str,
    verifier: str,
    kdf_params: dict[str, Any],
) -> dict[str, Any]:
    """修改账户密码主流程，返回 { success: True, relogin: True }（不返回 token）。

    :param session: 异步数据库会话（由路由依赖注入，事务化，退出自动提交）
    :param user_id: 当前登录用户 id（由 access token 解析并比对 version 后得到，见 api/validation.py）
    :param old_verifier: 客户端用旧密码本地派生的旧密码验证器（base64，非明文），用于核验持旧密码
    :param verifier: 客户端用新密码本地派生的新密码验证器（base64，非明文）
    :param kdf_params: 新的本地密钥派生配方（含新 client salt，后端仅透传存储）
    :returns: {"success": True, "relogin": True}
    :raises TokenInvalidError: userId 对应账户不存在（账户失效，401）
    :raises OldPasswordError: 旧密码验证器不符（401「旧密码不正确」）
    :raises SamePasswordError: 新密码与旧密码相同（400）
    """
    # 步骤 1：按主键取账户对象（需可写，故取整行 ORM 实体而非标量列）。
    # 取不到说明 token 里的 userId 已失效（账户被删等）：按登录态失效处理，统一 401。
    account = await session.get(Account, user_id)
    if account is None:
        raise TokenInvalidError("登录态无效，请重新登录")

    # 步骤 2：旧密码核验——对 old_verifier 叠加账户**当前** server_salt 慢哈希后恒定时间比对。
    # 不符即拒：身份虽已由 access token 确认，但改密这一敏感操作要求二次证明「确实掌握旧密码」，
    # 防 access 被借用 / 会话劫持后被改密。compare_digest 抹平时序侧信道。
    computed_old = hash_verifier(old_verifier, account.server_salt)
    if not secrets.compare_digest(computed_old, account.password_verifier):
        # 不记录任何 verifier 明文 / 密文，仅记 userId 与事件，便于安全审计且不泄露敏感数据。
        logger.warning("改密失败：旧密码不正确 userId=%s", user_id)
        raise OldPasswordError("旧密码不正确")

    # 步骤 3：新旧相同校验——用**当前** server_salt 对新 verifier 同款慢哈希，等于库里即视为未改。
    # 必须用当前 server_salt（与库里 password_verifier 同盐）才可直接比对；落库时再换新盐（步骤 4）。
    computed_new_old_salt = hash_verifier(verifier, account.server_salt)
    if secrets.compare_digest(computed_new_old_salt, account.password_verifier):
        logger.info("改密被拒：新旧密码相同 userId=%s", user_id)
        raise SamePasswordError("新密码不能与旧密码相同")

    # 步骤 4：生成新的 server_salt，对新 verifier 二次慢哈希后更新三列（与注册 / 登录 / 重置同实现）。
    # 直接改已加载 ORM 实体属性 → SQLAlchemy 在 flush 时生成 UPDATE；事务由 get_session 收尾提交。
    server_salt = generate_server_salt()
    account.server_salt = server_salt
    account.password_verifier = hash_verifier(verifier, server_salt)
    account.kdf_params = kdf_params
    await session.flush()

    # 步骤 5：全量会话失效（方案 B）——token_version 自增使旧 access 立即失效 + 同步缓存 + 清
    # refresh 白名单。change 与 reset 共用 invalidate_all_sessions，避免逻辑漂移。
    await invalidate_all_sessions(session, account)

    logger.info("改密成功，全部会话已失效 userId=%s", user_id)

    # 步骤 6：不签发 token——含当前设备在内的全部会话已失效，客户端须用新密码重新登录。
    return {"success": True, "relogin": True}
