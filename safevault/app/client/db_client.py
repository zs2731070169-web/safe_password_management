"""MySQL 异步连接管理（连接池）。

与 redis_client / mq_client 一致：进程内维护单个全局 async engine（内置连接池）
与会话工厂，FastAPI 在 lifespan 启动时 init_db()、关闭时 close_db()；worker 进程同样
可直接复用 init_db / get_session 这套连接逻辑。

连接池：SQLAlchemy async 引擎默认使用 QueuePool（AsyncAdaptedQueuePool），此处把
pool_size / max_overflow / pool_timeout / pool_recycle 显式交由配置驱动，便于按负载调优。
取连接前 pool_pre_ping 探活，自动剔除被 MySQL 回收的死连接。

驱动用 asyncmy（mysql+asyncmy://...），与 FastAPI async 链路一致。
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from config import settings

# 模块级单例：引擎与会话工厂。init_db() 前为 None，未初始化即调用会显式报错。
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


async def init_db() -> AsyncEngine:
    """创建并缓存全局异步引擎（带连接池）与会话工厂（幂等）。

    在 FastAPI lifespan 启动阶段调用。按 README 约定**不在此自动建表**，
    建表走独立脚本。连接池参数全部来自 settings，可经环境变量调优。

    :returns: 已就绪的 AsyncEngine
    """
    global _engine, _session_factory
    if _engine is None:
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            # ---- 连接池配置 ----
            pool_size=settings.db_pool_size,          # 常驻连接数
            max_overflow=settings.db_max_overflow,    # 峰值临时溢出连接数
            pool_timeout=settings.db_pool_timeout,    # 池满时获取连接的等待上限
            pool_recycle=settings.db_pool_recycle,    # 连接最长存活，规避 MySQL 断连
            pool_pre_ping=True,                       # 取连接前 ping，剔除死连接
        )
        _session_factory = async_sessionmaker(
            _engine,
            expire_on_commit=False,  # 提交后仍可访问对象属性，避免额外查询
            autoflush=False,
        )
    return _engine


def get_engine() -> AsyncEngine:
    """获取已初始化的引擎；未初始化则抛错提醒先 init_db()。"""
    if _engine is None:
        raise RuntimeError("数据库尚未初始化，请先调用 init_db()")
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """获取已初始化的会话工厂；未初始化则抛错提醒先 init_db()。"""
    if _session_factory is None:
        raise RuntimeError("数据库尚未初始化，请先调用 init_db()")
    return _session_factory


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖：提供一个事务化的异步会话。

    使用 ``begin()`` 包裹：正常退出自动提交，异常自动回滚，退出时把连接归还连接池。
    路由通过 ``session: AsyncSession = Depends(get_session)`` 注入。
    """
    factory = get_session_factory()
    async with factory() as session:
        async with session.begin():
            yield session


async def close_db() -> None:
    """释放连接池（dispose 关闭池内所有连接），供 lifespan 收尾调用。"""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
