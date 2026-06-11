"""认证相关路由。

已实现：§1 下发邮箱验证码、§2 注册开户、§3 登录解锁（含登录前拉取 kdf-params）、
§4 token 静默续签、§5 修改密码、§6 忘记密码重置。模块 1 云账户与认证的端点已全部到位。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_user_id, _client_ip
from client.db_client import get_session
from schemas.auth import (
    ChangePasswordRequest,
    ChangePasswordResponse,
    KdfParamsRequest,
    KdfParamsResponse,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    LogoutResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
    TokenPair,
    VerifyCodeRequest,
    VerifyCodeResponse,
)
from services.change_password import change_password as change_password_service
from services.login import get_login_kdf_params, login_account
from services.rate_limit import enforce_send_code_limit
from api.deps import rate_limit
from services.register import register_account
from services.reset_password import reset_account
from services.token import revoke_single_refresh_token, rotate_refresh_token
from services.verify_code import send_verify_code

router = APIRouter(prefix="/auth", tags=["auth"])





@router.post("/verify-code", response_model=VerifyCodeResponse)
async def verify_code(payload: VerifyCodeRequest, request: Request) -> VerifyCodeResponse:
    """下发邮箱验证码（注册 / 重置共用）。

    流程对齐时序图 §1：限流 → 校验邮箱格式（pydantic 已做）→ 冷却 → 生码写码 → 投递 MQ。
    成功立即返回，不等待邮件实际送达。
    """
    email = payload.email
    # 1) 限流（替代 API 网关）：邮箱 + IP 双维度，超限抛 429
    await enforce_send_code_limit(email, _client_ip(request))
    # 2) 发码编排：冷却命中抛 429，否则写码并投递 MQ
    await send_verify_code(email)
    return VerifyCodeResponse(sent=True)


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("register"))],  # 1) 注册限流（按 IP，超限抛 429）
)
async def register(
    payload: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> RegisterResponse:
    """注册开户（注册即登录）。

    流程对齐时序图 §2：
      1) 限流（IP 维度）→ 超限抛 429（已在路由依赖 rate_limit("register") 前置拦截）
      2) 校验验证码 → 缺失/不符抛 400「验证码错误或已过期」
      3) 查重 → 已注册抛 409「该邮箱已注册」
      4) 生成 server_salt、服务端慢哈希 verifier 后落库
      5) DEL code:{email}（用后即焚）
      6) 签发 access(15min)+refresh(30d)，refresh 写入 Redis 白名单
      7) 返回 201 { tokens, userId }
    """
    # 2~7) 业务编排（校验码 → 查重 → 落库 → 删码 → 签发 token）
    result = await register_account(
        session=session,
        email=payload.email,
        verifier=payload.verifier,
        kdf_params=payload.kdf_params,
        code=payload.code,
    )
    return RegisterResponse(**result)


@router.post(
    "/kdf-params",
    response_model=KdfParamsResponse,
    dependencies=[Depends(rate_limit("login"))],  # 1) 限流（与登录共用 IP 阈值，防批量探测）
)
async def kdf_params(
    payload: KdfParamsRequest,
    session: AsyncSession = Depends(get_session),
) -> KdfParamsResponse:
    """登录前拉取派生配方（§3 前置）。

    客户端无需在本地持久化 kdf_params 即可登录（支持清缓存 / 换设备）：
      1) 限流（IP 维度，复用登录限流）→ 超限抛 429（已在路由依赖前置拦截）
      2) 按邮箱取 kdf_params；未注册返回确定性伪配方（挡邮箱枚举，见 service）
    salt 非机密，公开返回符合零知识 / SRP 惯例。
    """
    # 2) 取真实 / 伪造 kdf_params（结构一致，不可区分）
    params = await get_login_kdf_params(session=session, email=payload.email)
    return KdfParamsResponse(kdf_params=params)


@router.post(
    "/login",
    response_model=LoginResponse,
    dependencies=[Depends(rate_limit("login"))],  # 1) 登录限流（按 IP，超限抛 429）
)
async def login(
    payload: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    """登录解锁。

    流程对齐时序图 §3：
      1) 限流（IP 维度）→ 超限抛 429（已在路由依赖 rate_limit("login") 前置拦截）
      2) 读 fail:{email} 失败计数 → 达阈值抛 423「账户暂时锁定，请稍后」
      3) 按邮箱取 server_salt / password_verifier / status
      4) 邮箱不存在 / 验证器不符 / 账户停用 → INCR fail（TTL 15min）→ 抛 401「邮箱或密码不正确」
      5) 校验通过 → DEL fail 清零 → 签发 access(15min)+refresh(30d) → 返回 200 { tokens, userId }
    """
    # 2~5) 业务编排（锁定判定 → 取账户 → 恒定时间比对 → 计 fail / 清零 → 签发 token）
    result = await login_account(
        session=session,
        email=payload.email,
        verifier=payload.verifier,
    )
    return LoginResponse(**result)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(payload: RefreshRequest) -> RefreshResponse:
    """token 静默续签（轮转作废旧 refresh）。

    流程对齐时序图 §4：refresh 直接走 Token 服务，**不经认证服务、不限流、不查库**
    （逻辑最薄，与图一致；身份完全由 refresh 的签名 + 白名单背书）：
      1) 校验 refresh 签名与有效期 → 非法 / 过期抛 401「请重新登录」
      2) 强制 type == "refresh"（防止拿 access 冒充）
      3) SISMEMBER 白名单 refresh:{userId} → 不在（已吊销/轮转/被盗用）抛 401「请重新登录」
      4) SREM 旧 jti（轮转作废）
      5) 签发新 access + 新 refresh 并 SADD 新 jti
      6) 返回 200 { tokens }（静默续签，用户无感）
    """
    # 续签编排全部收敛在 Token 服务 rotate_refresh_token（验签 → 白名单 → 轮转 → 签发）
    pair = await rotate_refresh_token(payload.refreshToken)
    return RefreshResponse(tokens=TokenPair(**pair))


@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    payload: ChangePasswordRequest,
    user_id: int = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> ChangePasswordResponse:
    """修改账户密码（方案 B 严格立即失效，改密成功须重新登录）。

    流程对齐时序图 §5，并叠加方案 B 的「旧密码核验 + 全量会话立即失效」增强：
      1) 校验 access token 未过期、token_version 一致 → 无效 401（已在依赖 get_current_user_id
         前置完成，并由它解析出当前登录用户的 userId）
      2) 旧密码核验：对 payload.old_verifier 叠加账户当前 server_salt 慢哈希后与库里
         password_verifier 恒定时间比对，不符抛 401「旧密码不正确」（防 access 被借用后改密）
      3) 新旧相同校验：新 verifier 与旧派生同一 verifier → 400「新密码不能与旧密码相同」
      4) UPDATE verifier、server_salt（含 kdf_params）BY userId —— 用客户端以**新密码**
         本地派生的新 verifier + 新 kdf_params（图中 newVerifier / newSalt；newSalt 内嵌在
         kdf_params 里，与 §2 注册同构），后端再生成新 server_salt 二次慢哈希后落库
      5) invalidate_all_sessions：token_version 自增（旧 access **立即失效**，零残留窗口）+
         同步 Redis 缓存 + DEL 全部 refresh 白名单（含当前设备在内的全部会话一并失效）
      6) 返回 200 { success: true, relogin: true } —— **不再签发 token**

    关于限流：本接口已有 access token 鉴权背书（非匿名可达），且改密非高频暴力面，
    暂不额外挂 IP 限流；若后续需防滥用，可仿照其它端点加 dependencies=[Depends(rate_limit(...))]。

    关于不返回 token（与早期「重发当前会话 token」的增强相反）：方案 B 下改密会自增 token_version，
    当前设备持有的 access 同样因 tv 落后立即失效；若再为当前设备重签新对，等于给「刚被吊销的会话」
    开后门，与「全量立即失效」语义自相矛盾。故改密成功语义即「需重新登录」，响应只含
    { success, relogin }，前端据此清本地 token、跳登录页用新密码重登（详见
    services/change_password.py 与 schemas.ChangePasswordResponse）。
    """
    # 2~6) 业务编排（旧密码核验 → 新旧相同校验 → 重算落库 → 全量会话立即失效）
    result = await change_password_service(
        session=session,
        user_id=user_id,
        old_verifier=payload.old_verifier,
        verifier=payload.verifier,
        kdf_params=payload.kdf_params,
    )
    return ChangePasswordResponse(**result)


@router.post(
    "/reset-password",
    response_model=ResetPasswordResponse,
    dependencies=[Depends(rate_limit("reset"))],  # 1) 重置限流（按 IP，超限抛 429）
)
async def reset_password(
    payload: ResetPasswordRequest,
    session: AsyncSession = Depends(get_session),
) -> ResetPasswordResponse:
    """忘记密码重置（凭邮箱验证码授权，重置后吊销全部会话、不自动登录）。

    流程对齐时序图 §6：
      1) 限流（IP 维度）→ 超限抛 429（已在路由依赖 rate_limit("reset") 前置拦截）
      2) 校验验证码 → 缺失/不符抛 400「验证码错误或已过期」
      3) 按 email 查 account 取 userId；账户不存在同样抛 400（同一提示，不泄露邮箱是否注册）
      4) 生成新 server_salt、对新 verifier 二次慢哈希后 UPDATE verifier/server_salt/kdf_params
      5) DEL code:{email}（用后即焚）
      6) invalidate_all_sessions（与 §5 改密共用）：token_version 自增使任何残存旧 access 立即失效
         + 同步 Redis 缓存 + DEL refresh:{userId} 清空白名单，强制全部会话重新登录
      7) 决策点 C → C2（恢复码包裹式密钥）：返回 200 { resetOk: true, recoverable: true }

    与 §5 改密的差异：重置发生在「忘记密码、无法登录」场景，**无 access token**，仅凭验证码授权，
    故请求体携带 email；且重置**不签发 token、不自动登录**（对齐图末「回登录页重新登录」）——前端
    在重置成功后随即用新密码走一次 §3 登录拿合法会话。决策点 C 取 C2：旧整库 blob 不作废，客户端用
    恢复码 GET /backup/recovery-blob 解出 DataKey、以新密码重新包裹并重传 PUT /backup 即可恢复云备份。
    """
    # 2~7) 业务编排（校验码 → 查账户 → 重算落库 → 删码 → 全量吊销 → C1 返回）
    result = await reset_account(
        session=session,
        email=payload.email,
        verifier=payload.verifier,
        kdf_params=payload.kdf_params,
        code=payload.code,
    )
    return ResetPasswordResponse(**result)


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    payload: LogoutRequest,
    user_id: int = Depends(get_current_user_id),
) -> LogoutResponse:
    """退出登录（吊销当前设备会话）。

    流程对齐时序图 §7：
      1) 校验 access token（未过期、token_version 一致）→ 无效 401（已在依赖 get_current_user_id
         前置完成，并解析出当前登录用户的 userId）。access 失效时此处直接 401，前端据此做**本地兜底
         登出**（仍清本地会话与 refresh）。
      2) 吊销该单个 refresh token：验签取 jti → SREM refresh:{userId}，即时失效该会话。
      3) 返回 200 { success: true }。

    设计要点（与 §5 改密 / §6 重置的关键区别）：logout **只删这一个 refresh、不自增 token_version**
    ——退出当前设备无需让 access 立即失效（短时效自然过期），更不波及其它设备会话。全程**只经 Token
    服务 + Redis，不连用户库**，故本端点无 session 依赖。幂等：refresh 已失效 / 不在白名单 / 重复登出
    均照常返回成功（见 services/token.revoke_single_refresh_token）。

    关于限流：已有 access token 鉴权背书（非匿名可达）、且登出非暴力面，暂不额外挂 IP 限流。
    """
    # 2) 吊销单个 refresh（幂等、对登出友好：验签 / 归属 / 白名单异常均静默视为已登出）
    await revoke_single_refresh_token(payload.refreshToken, user_id)
    return LogoutResponse()
