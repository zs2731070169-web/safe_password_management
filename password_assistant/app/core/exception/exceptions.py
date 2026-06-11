"""业务异常与 FastAPI 异常处理器。

把「冷却中」「限流」这类业务态用专门异常表达，路由层不必关心 HTTP 细节，
统一在 register_exception_handlers 里映射成对应状态码与中文提示。
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """业务异常基类。

    :param message: 面向客户端的中文提示
    :param status_code: 期望返回的 HTTP 状态码
    """

    status_code: int = 400

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class CooldownError(AppError):
    """同一邮箱处于发码冷却期内（60s）。对应时序图 429「请稍后再试」。"""

    status_code = 429


class RateLimitError(AppError):
    """触发滑动窗口限流（按 IP / email）。对应时序图网关 429。"""

    status_code = 429


class InvalidCodeError(AppError):
    """邮箱验证码缺失 / 不符。对应时序图 §2 400「验证码错误或已过期」。"""

    status_code = 400


class EmailExistsError(AppError):
    """邮箱已注册。对应时序图 §2 409「该邮箱已注册」。"""

    status_code = 409


class AccountLockedError(AppError):
    """登录失败次数超过阈值，账户被临时锁定。对应时序图 §3 423「账户暂时锁定，请稍后」。

    临时锁定只走 Redis fail 计数 + TTL，不落 account.status；TTL 过期即自动解锁。
    """

    status_code = 423


class AuthFailedError(AppError):
    """邮箱不存在 / 验证器不符 / 账户停用，统一对外 401「邮箱或密码不正确」。

    对应时序图 §3 401。三种情形不区分提示,避免被用于探测邮箱是否注册。
    """

    status_code = 401


class OldPasswordError(AppError):
    """改密（§5）时旧密码验证器不符，对外 401「旧密码不正确」。

    与登录 AuthFailedError 同为 401，但语义独立（改密场景，身份已由 access token 确认，
    这里校验的是「确实掌握旧密码」）。service 层用恒定时间比对 old_verifier 与库里
    password_verifier，不符即抛此异常，防止据响应差异 / 耗时枚举旧密码。
    """

    status_code = 401


class SamePasswordError(AppError):
    """改密（§5）时新密码与旧密码相同，对外 400「新密码不能与旧密码相同」。

    旧 verifier 比对通过后，再用账户当前 server_salt 对新 verifier 做同款慢哈希，若结果与库里
    password_verifier 相同，说明新旧密码派生出同一 verifier（即未真正修改），拒绝并提示。
    """

    status_code = 400


class TokenInvalidError(AppError):
    """refresh token 非法，统一对外 401「请重新登录」。

    对应时序图 §4 401「请重新登录」：refresh 签名/有效期非法或不在白名单
    （已吊销 / 轮转 / 被盗用）。客户端收到后应清登录态并回登录页（§3）重新登录。
    """

    status_code = 401


class BackupTooLargeError(AppError):
    """上传备份体积超过上限（模块 2 PUT /backup）。对应时序图 §1 413「备份体积超限」。

    ciphertext（base64）解出的原始密文字节数 > settings.backup_max_size_bytes 时抛出。
    用 413 Payload Too Large 精确表达「请求体过大」，前端据此提示用户（如清理过多条目 / 附件）。
    """

    status_code = 413


class InvalidChecksumError(AppError):
    """上传备份的 checksum 非法（模块 2 PUT /backup）。对应时序图 §1 400「校验值非法」。

    checksum 必须是合法的 64 位十六进制 SHA-256 摘要；格式不符（长度 / 非 hex 字符）即拒，
    在边界挡住明显损坏 / 伪造的请求，不让脏数据进入 OSS 与元信息库。
    """

    status_code = 400


class BackupVersionConflictError(AppError):
    """上传 version ≤ 云端当前 version（模块 2 PUT /backup）。对应时序图 §1 409「版本冲突」。

    单调 version 防回退：旧版本 / 并发误写不得覆盖云端更新的快照。前端收到 409 应先
    GET /backup 拉取最新、合并后以更高 version 重试（提示「请先拉取最新再重试」）。
    """

    status_code = 409


class BackupNotFoundError(AppError):
    """该账户云端暂无备份（模块 2 GET /backup）。对应时序图 §2 404「云端暂无备份」。

    仅 GET /backup（下载整库）在无备份时返回 404；GET /backup/meta 用 { hasBackup:false }
    表达「尚未备份」（200），DELETE /backup 则幂等返回成功，三者语义刻意区分。
    """

    status_code = 404


def register_exception_handlers(app: FastAPI) -> None:
    """把业务异常注册到 FastAPI，统一输出 { detail: 提示 } 结构。"""

    @app.exception_handler(AppError)
    async def _handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message},
        )
