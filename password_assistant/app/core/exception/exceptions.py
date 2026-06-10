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


def register_exception_handlers(app: FastAPI) -> None:
    """把业务异常注册到 FastAPI，统一输出 { detail: 提示 } 结构。"""

    @app.exception_handler(AppError)
    async def _handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message},
        )
