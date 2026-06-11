"""认证模块的请求 / 响应模型。"""
from typing import Any

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


class RegisterRequest(BaseModel):
    """注册开户请求体，对齐时序图 §2 `{ email, verifier, kdf_params, code }`。

    零知识：`verifier` 是客户端本地用明文密码派生的「密码验证器」（非明文密码），
    `kdf_params` 是本地派生配方（后端仅透传存储）。后端永不接触明文密码。
    """

    email: EmailStr
    # 密码验证器（base64 文本）：限定长度上限，避免超大字段；下限保证非空有效派生产物
    verifier: str = Field(min_length=16, max_length=1024)
    # 本地密钥派生配方（algorithm/salt/iterations/length 等）；结构由前端约定，后端不解析语义
    kdf_params: dict[str, Any]
    # 邮箱验证码：6 位数字
    code: str = Field(min_length=4, max_length=8)

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("verifier", "code")
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
    """登录解锁请求体，对齐时序图 §3 `{ email, verifier }`。

    `verifier` 即图中的 `verifierProof`：客户端本地用「明文密码 + 注册时的 kdf_params
    （含 client salt）」重算出的同一个密码验证器（base64，非明文）。字段名与 §2 注册请求体
    的 `verifier` 保持一致，零知识——后端永不接触明文密码。
    """

    email: EmailStr
    # 密码验证器（base64 文本）：长度约束与 RegisterRequest.verifier 对齐
    verifier: str = Field(min_length=16, max_length=1024)

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("verifier")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带空格导致比对失败。"""
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
    """修改账户密码请求体，对齐时序图 §5 `{ newVerifier, newSalt }`。

    字段映射（重要）：图中的 `newVerifier` 即本字段 `verifier`，`newSalt`（client salt）
    并非裸字段，而是内嵌在 `kdf_params` 里（见前端 utils/kdf.js `deriveVerifier` 产出的
    `{ verifier, kdfParams:{algorithm, salt, iterations, length} }`）。因此改密请求体与
    §2 注册请求体的 `{ verifier, kdf_params }` 完全同构——客户端用**新密码**本地重派生出新的
    client salt 与新 verifier，明文密码不出端；后端再自行生成新的 server_salt、用
    services/verifier.hash_verifier 二次慢哈希后落库，与注册 / 登录的零知识链路保持一致。

    身份不在请求体内：调用方须带 `Authorization: Bearer <access>`，userId 由
    get_current_user_id 依赖从 access token 解析（见 api/validation.py），故此处无需 email。

    旧密码校验：新增 `old_verifier`——客户端用**旧密码**本地派生的旧密码验证器（与登录 §3 的
    verifier 同构）。服务端先对它叠加账户当前 server_salt 慢哈希后与库里 password_verifier
    做恒定时间比对，确认确为本人持旧密码后才允许改密；不符抛认证失败异常（防枚举 / 防时序）。
    """

    # 旧密码验证器（base64 文本）：客户端用旧密码本地派生，服务端校验确为本人持旧密码。
    # 长度约束与 RegisterRequest.verifier 对齐；恒定时间比对在 service 层完成。
    old_verifier: str = Field(min_length=16, max_length=1024)
    # 新密码验证器（base64 文本）：长度约束与 RegisterRequest.verifier 对齐
    verifier: str = Field(min_length=16, max_length=1024)
    # 新的本地密钥派生配方（含新 client salt）；后端仅透传存储，不解析语义
    kdf_params: dict[str, Any]

    @field_validator("old_verifier", "verifier")
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


class KdfParamsRequest(BaseModel):
    """登录前拉取派生配方请求体 `{ email }`。

    §3 登录需用注册时的同一份 kdf_params（含 client salt）在本地重算 verifier。
    salt 并非机密（SRP / 零知识方案中服务端公开返回 salt），故提供此接口让客户端
    无需在本地持久化即可登录，支持清缓存 / 换设备。
    """

    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)


class KdfParamsResponse(BaseModel):
    """派生配方响应体 `{ kdf_params }`。

    邮箱已注册返回其真实 kdf_params；未注册返回**确定性伪配方**（据邮箱推导，
    同邮箱恒定），使两种响应不可区分，挡邮箱枚举——未注册者据此派生的 verifier
    在 §3 登录时自然比不中，照常 401。
    """

    kdf_params: dict[str, Any]


class ResetPasswordRequest(BaseModel):
    """忘记密码重置请求体，对齐时序图 §6 `{ email, code, newVerifier, newSalt }`。

    字段映射（重要，与 §2 RegisterRequest 完全对齐，不用图里示意的 newVerifier/newSalt 裸名）：
      - 图中 `newVerifier` 即本字段 `verifier`：客户端用**新密码**本地零知识派生的新密码验证器；
      - 图中 `newSalt`（client salt）并非裸字段，而内嵌在 `kdf_params` 里（见前端 utils/kdf.js
        deriveVerifier 产出的 `{ verifier, kdfParams:{algorithm, salt, iterations, length} }`）；
      - `server_salt` 不在请求体内，由后端在重置时自行重新生成（见 services/reset_password.py）。
    因此重置请求体与注册请求体的 `{ email, verifier, kdf_params, code }` 同构——明文密码不出端，
    后端永不接触明文。身份不靠 token：重置发生在「忘记密码、无法登录」场景，仅凭邮箱验证码授权。
    """

    email: EmailStr
    # 新密码验证器（base64 文本）：长度约束与 RegisterRequest.verifier 对齐
    verifier: str = Field(min_length=16, max_length=1024)
    # 新的本地密钥派生配方（含新 client salt）；后端仅透传存储，不解析语义
    kdf_params: dict[str, Any]
    # 邮箱验证码：与注册同一约束（§1 下发的 6 位数字）
    code: str = Field(min_length=4, max_length=8)

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("verifier", "code")
    @classmethod
    def _strip(cls, v: str) -> str:
        """去除首尾空白，避免前端误带空格。"""
        return v.strip()


class ResetPasswordResponse(BaseModel):
    """忘记密码重置响应体，对齐时序图 §6 `200 { resetOk, cloudBackupCleared: true }`（走决策点 C1）。

    决策点 C 取 **C1（接受丢失，纯零知识）**：重置只换后端登录凭据，无法解开旧密码包裹的云端 blob，
    故标记旧 blob 失效、提示用户重新上传，`cloudBackupCleared` 恒为 true。重置**不签发 token、不自动
    登录**（对齐图末「重置不自动登录 → 回登录页重新登录」），故响应不含 tokens。待模块 2（备份服务）
    接入后可改走 C2（恢复凭据 key escrow）恢复 DataKey，届时再扩展响应字段（如 recoverable）。
    """

    resetOk: bool = True
    cloudBackupCleared: bool = True


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
