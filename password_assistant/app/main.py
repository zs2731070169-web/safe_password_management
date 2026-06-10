"""FastAPI 应用入口。

负责：lifespan 内启停 MySQL / Redis / RabbitMQ 连接、注册路由与业务异常处理器。
启动（在 app/ 目录下）：uvicorn main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.auth import router as auth_router
from client.mq_client import init_mq, close_mq
from client.redis_client import close_redis, init_redis
from core.exception.exceptions import register_exception_handlers

logger = logging.getLogger("safevault.main")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """应用生命周期：启动时建连，关闭时释放。"""
    # 启动：先连 Redis、MQ，任一失败则启动中断
    await init_redis()
    await init_mq()
    yield
    # 关闭：逆序释放连接
    await close_mq()
    await close_redis()


app = FastAPI(
    title="SafeVault 认证服务",
    description="SafeVault 模块 1：云账户与认证。当前实现下发邮箱验证码。",
    version="1.0.0",
    lifespan=lifespan,
)

# 注册业务异常处理器（CooldownError / RateLimitError → 对应状态码）
register_exception_handlers(app)

# 注册路由
app.include_router(auth_router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """健康检查，便于容器探针 / 联调确认服务存活。"""
    return {"status": "ok"}
