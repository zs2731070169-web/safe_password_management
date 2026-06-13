"""认证模块的请求 / 响应模型。"""
from pydantic import BaseModel, EmailStr, Field, field_validator


def _normalize_email(v: str) -> str:
    """邮箱归一化：去首尾空格并转小写，避免大小写 / 空格导致的同邮箱多记录。"""
    return v.strip().lower()


class VerifyCodeRequest(BaseModel):
    """下发验证码请求体。EmailStr 自动校验邮箱格式，非法直接 422。"""

    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)


class VerifyCodeResponse(BaseModel):
    """下发验证码响应体，对齐时序图 200 { sent: true }。"""

    sent: bool = True


# 密码封装（sealed-box）字段的公共长度约束：base64(eph_pub32 ‖ iv12 ‖ ct+tag≥16)，
# 最小 60 字节 → base64 约 80 字符；上限放宽到 4096 兜住超长口令，避免超大字段攻击。
_SEALED_MIN = 64
_SEALED_MAX = 4096


class RegisterRequest(BaseModel):
    """注册开户请求体，对齐登录提速方案 `{ email, sealed_password, code }`。

    `sealed_password` 是客户端用服务端 X25519 公钥把**明文密码**非对称封装（ECIES）后的 base64
    （见前端 utils/seal.js / 后端 services/seal.py）。后端解封得明文后慢哈希落库，明文不落盘。
    """

    email: EmailStr
    # 密码封装（base64）：base64(eph_pub ‖ iv ‖ ciphertext+tag)
    sealed_password: str = Field(min_length=_SEALED_MIN, max_length=_SEALED_MAX)
    # 邮箱验证码：6 位数字
    code: str = Field(min_length=4, max_length=8)

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("sealed_password", "code")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带空格。"""
        return v.strip()


class TokenPair(BaseModel):
    """access + refresh token 对，对齐时序图 token 服务返回结构。"""

    accessToken: str
    refreshToken: str


class RegisterResponse(BaseModel):
    """注册响应体，对齐时序图 §2 `201 { tokens, userId }`（注册即登录）。"""

    tokens: TokenPair
    userId: int


class LoginRequest(BaseModel):
    """登录解锁请求体，对齐登录提速方案 `{ email, sealed_password }`。

    `sealed_password` 是客户端用服务端公钥把明文密码非对称封装后的 base64（同 RegisterRequest）。
    后端解封得明文 → 用账户 server_salt 慢哈希 → 与库里 password_verifier 恒定时间比对。
    无需再先拉 kdf-params（该往返已废除），明文密码不出端的纵深防御由封装提供。
    """

    email: EmailStr
    # 密码封装（base64）：约束与 RegisterRequest.sealed_password 对齐
    sealed_password: str = Field(min_length=_SEALED_MIN, max_length=_SEALED_MAX)

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("sealed_password")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带空格导致解封失败。"""
        return v.strip()


class LoginResponse(BaseModel):
    """登录响应体，对齐时序图 §3 `200 { tokens, userId }`，与 RegisterResponse 同构。"""

    tokens: TokenPair
    userId: int


class RefreshRequest(BaseModel):
    """token 静默续签请求体，对齐时序图 §4 `{ refreshToken }`。

    只携带 refresh token（JWT 文本）；续签直接走 Token 服务，不带其它身份信息。
    min_length=16 拦截明显空 / 残缺值，真正的签名 / 有效期 / 白名单校验在服务层。
    """

    refreshToken: str = Field(min_length=16)

    @field_validator("refreshToken")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带换行 / 空格导致验签失败。"""
        return v.strip()


class RefreshResponse(BaseModel):
    """token 续签响应体。

    时序图 §4 画的是扁平 `{ accessToken, refreshToken }`（仅示意）；这里按工程一致性
    用 `{ tokens: TokenPair }` 包一层，与 RegisterResponse / LoginResponse 同构，
    便于前端统一读 `res.tokens.accessToken`。
    """

    tokens: TokenPair


class ChangePasswordRequest(BaseModel):
    """修改账户密码请求体，对齐登录提速方案 `{ sealed_old_password, sealed_new_password }`。

    身份不在请求体内：调用方须带 `Authorization: Bearer <access>`，userId 由
    get_current_user_id 依赖从 access token 解析（见 api/deps.py），故此处无需 email。

    `sealed_old_password`：客户端用旧密码做的封装，服务端解封后慢哈希与库里 password_verifier
    恒定时间比对，确认确为本人持旧密码；`sealed_new_password`：新密码的封装，服务端解封后用新
    server_salt 慢哈希落库。明文密码仅在服务端内存内短暂存在，不落盘。
    """

    # 旧密码封装（base64）：服务端解封后校验确为本人持旧密码（恒定时间比对在 service 层完成）
    sealed_old_password: str = Field(min_length=_SEALED_MIN, max_length=_SEALED_MAX)
    # 新密码封装（base64）
    sealed_new_password: str = Field(min_length=_SEALED_MIN, max_length=_SEALED_MAX)

    @field_validator("sealed_old_password", "sealed_new_password")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带空格。"""
        return v.strip()


class ChangePasswordResponse(BaseModel):
    """修改账户密码响应体，对齐时序图 §5 `200 { success }`。

    方案 B（严格立即失效）下，改密成功会：① token_version 自增 → 旧 access **立即失效**；
    ② DEL 全部 refresh 白名单。两者叠加使该用户**全部会话（含当前设备）一并失效**，故改密
    **不再返回新 token**——响应只含 `success` 与 `relogin` 提示语义。前端约定：改密成功后清
    本地 token、跳登录页用新密码重新登录（与重置 §6 的「不自动登录」语义一致）。
    """

    success: bool = True
    # 明确告知客户端需重新登录（改密已使含当前设备在内的全部会话失效）
    relogin: bool = True


class SealPubKeyResponse(BaseModel):
    """服务端密码封装公钥响应体 `{ public_key }`（GET /auth/seal-pubkey）。

    public_key 为服务端 X25519 公钥（32 字节原始公钥的 base64）。客户端据此把明文密码封装后上送
    注册 / 登录 / 改密 / 重置。公钥公开不损安全（私钥永不出端）。
    """

    public_key: str


class ResetPasswordRequest(BaseModel):
    """忘记密码重置请求体，对齐登录提速方案 `{ email, sealed_new_password, code }`。

    身份不靠 token：重置发生在「忘记密码、无法登录」场景，仅凭邮箱验证码授权。
    `sealed_new_password` 是客户端用**新密码**做的封装；后端解封后生成新 server_salt 慢哈希落库
    （server_salt 由后端重置时自行重新生成，不在请求体内）。明文密码不落盘。
    """

    email: EmailStr
    # 新密码封装（base64）：约束与 RegisterRequest.sealed_password 对齐
    sealed_new_password: str = Field(min_length=_SEALED_MIN, max_length=_SEALED_MAX)
    # 邮箱验证码：与注册同一约束（§1 下发的 6 位数字）
    code: str = Field(min_length=4, max_length=8)

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("sealed_new_password", "code")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带空格。"""
        return v.strip()


class ResetPasswordResponse(BaseModel):
    """忘记密码重置响应体，对齐时序图 §6 `200 { resetOk, recoverable: true }`（走决策点 C2）。

    决策点 C 取 **C2（恢复码包裹式密钥，key escrow）**：包裹式密钥方案下整库密文由随机 DataKey 加密，
    DataKey 被「密码」与「恢复码」各包裹一份独立存放。重置只换后端登录凭据，**旧整库 blob 无需作废**——
    客户端随后用恢复码 GET /backup/recovery-blob 解出 DataKey，以新密码重新包裹并 PUT /backup 重传，
    旧云备份即被新密码可解。故响应**不再含 cloudBackupCleared**，改返回 `recoverable=true`（语义：旧备份
    仍在、可经恢复码恢复）。重置**不签发 token、不自动登录**（对齐图末「重置不自动登录 → 回登录页重新
    登录」），故响应不含 tokens。
    """

    resetOk: bool = True
    # 旧云备份可经恢复码恢复：客户端据此走「恢复码解 DataKey → 新密码重新包裹 → 重传备份」恢复流程，
    # 而非提示用户「云备份已丢失需重新上传」（后者为旧 C1 语义，已废弃）。
    recoverable: bool = True


class LogoutRequest(BaseModel):
    """退出登录请求体，对齐时序图 §7 `{ refreshToken }`。

    只携带待吊销的 refresh token（JWT 文本），与 RefreshRequest 同构；身份由请求头
    `Authorization: Bearer <access>` 背书（userId 经 get_current_user_id 解析），故体内无需 email。
    min_length=16 拦截明显空 / 残缺值，真正的验签与归属校验在服务层（且登出对验签失败友好）。
    """

    refreshToken: str = Field(min_length=16)

    @field_validator("refreshToken")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带换行 / 空格。"""
        return v.strip()


class LogoutResponse(BaseModel):
    """退出登录响应体，对齐时序图 §7 `200 { success: true }`。

    幂等语义：refresh 已失效 / 不在白名单 / 重复登出，后端均照常返回 success=true
    （登出本就是要让会话失效，无需因 refresh 已不可用而报错）。
    """

    success: bool = True
