"""注册开户业务编排（对齐时序图 §2 认证服务部分，认证已改为非对称封装上送密码）。

严格按步骤推进（步骤号与图中 autonumber 对应）：
  2. decrypt_sealed 解封 sealed_password → 得明文密码（封装非法抛 SealDecryptError 400）
  3. GET code:{email} 校验验证码 → 缺失 / 不符 抛 InvalidCodeError(400)
  4. SELECT email 查重 → 已存在 抛 EmailExistsError(409)
  5. 生成 server_salt → INSERT { email, server_salt, password_verifier(明文密码服务端慢哈希后), kdf_params 标记 }
  6. DEL code:{email}（用后即焚）
  7. 签发 access + refresh 并写 refresh 白名单（见 services/token.py）

提速方案：客户端用服务端公钥把明文密码非对称封装上送，后端解封得明文后慢哈希落库——明文密码仅在
服务端内存内短暂存在、不落盘；库里只存「明文密码 + server_salt」的 PBKDF2 慢哈希，库泄露无法离线
低成本还原口令。保险库的零知识加密与 DataKey 派生不受影响（仍全在客户端本地）。
限流（IP 维度）由调用方（路由层）先行处理，此处不重复。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.exception.exceptions import EmailExistsError
from client.redis_client import get_redis
from models.account import Account
from services.token import issue_token_pair
# 验证码读写 key 与校验逻辑统一收敛到 services/verify_code.py：发码（§1）与校验（§2/§6）
# 共用同一 _code_key 与 verify_code，杜绝读写 key 不一致或两处校验算法漂移。
from services.verify_code import _code_key, verify_code
# server_salt 生成与口令服务端慢哈希抽到共享模块，与登录（§3）比对共用同一实现，
# 杜绝两处算法漂移导致登录永远比不中（详见 services/verifier.py）。
from services.verifier import generate_server_salt, hash_password
from services.seal import decrypt_sealed

# kdf_params 列在认证零知识废除后已无认证语义，但列约束为 NOT NULL；存一个 scheme 标记既满足约束，
# 又为未来可能的「旧零知识账户 / 新封装账户」区分留痕（当前不参与计算）。
_KDF_PARAMS_MARKER: dict[str, Any] = {"scheme": "sealed-v1"}


async def register_account(
    session: AsyncSession,
    email: str,
    sealed_password: str,
    code: str,
) -> dict[str, Any]:
    """注册开户主流程，返回 { tokens, userId }（注册即登录）。

    :param session: 异步数据库会话（由路由依赖注入，事务化）
    :param email: 已归一化（小写、去空格）邮箱
    :param sealed_password: 客户端用服务端公钥封装的明文密码（base64，见 services/seal.py）
    :param code: 邮箱验证码
    :returns: {"tokens": {"accessToken", "refreshToken"}, "userId": int}
    :raises SealDecryptError: 密码封装无效（400）
    :raises InvalidCodeError: 验证码缺失 / 不符（400）
    :raises EmailExistsError: 邮箱已注册（409）
    """
    redis = get_redis()

    # 步骤 2：解封得明文密码（封装非法 / 校验不过 → SealDecryptError 400）
    password = decrypt_sealed(sealed_password)

    # 步骤 3：校验验证码（共享 services/verify_code.verify_code，与重置 §6 同一实现）
    await verify_code(email, code)

    # 步骤 4：查重（邮箱唯一）。先查一次给出明确 409；唯一索引作为并发兜底（见下方 IntegrityError）。
    existing = await session.scalar(select(Account.id).where(Account.email == email))
    if existing is not None:
        raise EmailExistsError("该邮箱已注册")

    # 步骤 5：生成 server_salt → 服务端慢哈希明文密码 → 落库（共享 services/verifier.py 实现）
    server_salt = generate_server_salt()
    stored_verifier = hash_password(password, server_salt)
    account = Account(
        email=email,
        server_salt=server_salt,
        password_verifier=stored_verifier,
        kdf_params=_KDF_PARAMS_MARKER,
    )
    session.add(account)
    try:
        # flush 触发 INSERT 并拿到自增主键 id（即 userId），但不提交（提交由会话依赖收尾）
        await session.flush()
    except IntegrityError as exc:
        # 并发下两个请求同时通过查重后撞唯一索引：转成业务 409，语义与「已注册」一致
        raise EmailExistsError("该邮箱已注册") from exc

    user_id = account.id

    # 步骤 6：DEL code:{email}（用后即焚，防验证码复用）
    await redis.delete(_code_key(email))

    # 步骤 7：签发 access + refresh，并写入 refresh 白名单。
    # 新账户 token_version 取库默认值 1（flush 后 server_default 已回填到实体），随 access 的 tv 下发。
    tokens = await issue_token_pair(user_id, account.token_version)

    return {"tokens": tokens, "userId": user_id}
