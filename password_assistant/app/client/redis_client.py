"""Redis 异步连接管理。

进程内维护单个连接池，FastAPI 在 lifespan 启动时 init、关闭时 close。
worker 进程同样可直接调用 init_redis / get_redis 复用这套连接逻辑。
"""
from __future__ import annotations

import redis.asyncio as redis

from config import settings

_client: redis.Redis | None = None


async def init_redis() -> redis.Redis:
    """创建并缓存全局 Redis 客户端（带连接池）。

    decode_responses=True 让读写都按 str 处理，验证码 / 计数无需手动 decode。
    """
    global _client
    if _client is None:
        _client = redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        # 启动即 ping 一次，连接异常尽早暴露
        await _client.ping()
    return _client


def get_redis() -> redis.Redis:
    """获取已初始化的 Redis 客户端；未初始化则抛错提醒先 init。"""
    if _client is None:
        raise RuntimeError("Redis 尚未初始化，请先调用 init_redis()")
    return _client


async def close_redis() -> None:
    """关闭连接池，供 lifespan 收尾调用。"""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
