"""FastAPI 应用入口。

负责：lifespan 内启停 MySQL / Redis / RabbitMQ 连接、注册路由与业务异常处理器。
启动（在 app/ 目录下）：uvicorn main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.auth import router as auth_router
from api.backup import router as backup_router
from client.db_client import close_db, init_db
from client.mq_client import init_mq, close_mq
from client.oss_client import close_oss, init_oss
from client.redis_client import close_redis, init_redis
from core.exception.exceptions import register_exception_handlers

logger = logging.getLogger("safevault.main")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """应用生命周期：启动时建连，关闭时释放。"""
    # 启动：建 MySQL 引擎（不建表，建表走 `python -m core.base.init_db`）、连 Redis、MQ、对象存储。
    # 对象存储缺配置时 init_oss 仅告警不阻断（见 client/oss_client.py），其它模块照常工作。
    await init_db()
    await init_redis()
    await init_mq()
    # 对象存储（默认 MinIO）缺配置时 init_oss 仅告警不阻断启动，认证等其它模块照常工作。
    await init_oss()
    yield
    # 关闭：逆序释放连接
    await close_oss()
    await close_mq()
    await close_redis()
    await close_db()


app = FastAPI(
    title="SafeVault 后端服务",
    description=(
        "SafeVault 模块 1：云账户与认证（下发邮箱验证码、注册开户、登录解锁、token 续签、"
        "修改密码、忘记密码重置）；模块 2：加密备份 blob 存储（上传 / 下载 / 元信息 / 删除整库"
        "密文快照，密文存阿里云 OSS，零知识）。"
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# 注册业务异常处理器（CooldownError / RateLimitError / Backup* → 对应状态码）
register_exception_handlers(app)

# 全部业务接口统一挂在 /safevault 根下
API_ROOT = "/safevault"

# 注册路由
app.include_router(auth_router, prefix=API_ROOT)
app.include_router(backup_router, prefix=API_ROOT)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """健康检查，便于容器探针 / 联调确认服务存活。"""
    return {"status": "ok"}
