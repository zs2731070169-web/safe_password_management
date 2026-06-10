"""滑动窗口限流（替代时序图中的「API 网关限流」）。

用 Redis ZSET 实现：score = 请求时间戳（秒），member = 唯一标识。
每次请求先剔除窗口外的旧记录，再统计窗口内数量，超阈值即拒绝。
按 IP 与 email 两个维度各维护一个 ZSET，任一超限都拦截。
"""
from __future__ import annotations

import time
import uuid

from config import settings
from core.exception.exceptions import RateLimitError
from client.redis_client import get_redis


async def _check_window(key: str, limit: int, window: int) -> None:
    """对单个限流 key 做一次滑动窗口判定，超限抛 RateLimitError。

    用 pipeline 把「清理 + 计数 + 写入 + 续期」打包成一次往返，减少竞态与开销。
    """
    redis = get_redis()
    now = time.time()
    member = f"{now:.6f}:{uuid.uuid4().hex}"  # 保证窗口内 member 唯一
    min_score = now - window

    pipe = redis.pipeline()
    await pipe.zremrangebyscore(key, 0, min_score)  # 移除窗口外旧记录
    await pipe.zadd(key, {member: now})             # 记录本次请求
    await pipe.zcard(key)                           # 统计窗口内（含本次）总数
    await pipe.expire(key, window)                  # key 续期，闲置自动回收
    _, _, count, _ = await pipe.execute()

    if count > limit:
        # 已写入的本次记录留在 ZSET 中无妨：会随窗口滑动自然过期，
        # 且把「被拒绝的请求」也计入窗口，对刷量行为更严格。
        raise RateLimitError("请求过于频繁，请稍后再试", status_code=429)


async def enforce_send_code_limit(email: str, client_ip: str) -> None:
    """发码接口限流：邮箱与 IP 双维度校验。

    :param email: 目标邮箱（已小写归一）
    :param client_ip: 客户端 IP（取自网关透传或直连地址）
    """
    window = settings.rate_limit_window
    await _check_window(
        f"ratelimit:email:{email}",
        settings.rate_limit_email_per_window,
        window,
    )
    await _check_window(
        f"ratelimit:ip:{client_ip}",
        settings.rate_limit_ip_per_window,
        window,
    )
