"""通用 RabbitMQ 消费者（与业务无关的消费框架）。

`consume` 为唯一通用入口：给定队列名、消息模型与处理函数，负责连接、声明持久化拓扑、
解析校验、幂等去重、手动确认与失败重试等与业务无关的机制；具体任务只需提供一个 handler。

具体业务消费者（如发码邮件）放在 `comsumer/` 目录下，import 本模块的 `consume`
组装队列、消息模型与 handler，并各自作为独立进程启动（见 `comsumer/mail.py`）。

可靠性设计：
  - 手动消费确认：每条消息显式 ack，绝不依赖自动确认，确保「处理完成」才从队列移除；
  - 幂等去重：消息携带唯一 message_id，已成功处理过的（重复投递 / redeliver）直接确认跳过，
    幂等标记只在 handler 成功后写入 —— 故失败重试仍能再次执行，而「成功后 ack 丢失被
    重新投递」会被幂等拦截，不会重复消费（如不会重复发邮件）；
  - 应用层重试：handler 抛异常时按消息 header 的重试计数重投（复用同一 message_id 保持幂等
    身份），超上限则丢弃并记错误日志（生产可改接死信队列做后续处理）；
  - 幂等存储依赖 Redis，消费者进程须先 init_redis（见 comsumer/mail.py）；Redis 异常时
    降级为「至少一次」语义（记日志后照常处理 / 确认），优先保证送达不阻塞。
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable, TypeVar

import aio_pika
from aio_pika.abc import AbstractExchange, AbstractIncomingMessage
from pydantic import BaseModel, ValidationError

from config import settings
from client.mq_client import declare_topology
from client.redis_client import get_redis

logger = logging.getLogger("safevault.consumer")

# 最大重试次数：首投 + MAX_RETRIES 次重投
MAX_RETRIES = 3
# 同时处理的未确认消息上限，防止单消费者积压过多
PREFETCH_COUNT = 10

M = TypeVar("M", bound=BaseModel)
# 消息处理函数：拿到已解析校验的消息体，异步处理；抛异常即触发重试
Handler = Callable[[M], Awaitable[None]]


def _retry_count(message: AbstractIncomingMessage) -> int:
    """从消息 header 读取已重试次数，缺省为 0。"""
    headers = message.headers or {}
    try:
        return int(headers.get("x-retry-count", 0))
    except (TypeError, ValueError):
        return 0


def _idempotent_key(queue: str, message_id: str) -> str:
    """幂等去重的 Redis key：按队列 + 消息唯一 ID 命名。"""
    return f"mq:done:{queue}:{message_id}"


async def _already_done(queue: str, message_id: str | None) -> bool:
    """该消息是否已成功处理过（幂等命中）。Redis 异常时降级为「未处理」，优先不漏处理。"""
    if not message_id:
        return False
    try:
        return bool(await get_redis().exists(_idempotent_key(queue, message_id)))
    except Exception as exc:  # noqa: BLE001 Redis 故障降级，不阻断消费
        logger.warning("幂等检查失败[%s]，降级继续处理，err=%s", queue, exc)
        return False


async def _mark_done(queue: str, message_id: str | None) -> None:
    """标记该消息已成功处理（带 TTL）。仅在 handler 成功后调用。"""
    if not message_id:
        return
    try:
        await get_redis().set(
            _idempotent_key(queue, message_id), "1", ex=settings.idempotent_ttl
        )
    except Exception as exc:  # noqa: BLE001 标记失败不影响本次已完成的处理
        logger.warning("幂等标记写入失败[%s] id=%s，err=%s", queue, message_id, exc)


async def _republish_for_retry(
    exchange: AbstractExchange,
    queue: str,
    message_id: str | None,
    body: bytes,
    retry_count: int,
) -> None:
    """重投一条消息并把重试计数 +1（用新消息携带 header，避免原消息不可改）。

    复用原 message_id 让重投消息与原消息保持同一幂等身份。
    """
    message = aio_pika.Message(
        body=body,
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        content_type="application/json",
        message_id=message_id,
        headers={"x-retry-count": retry_count + 1},
    )
    await exchange.publish(message, routing_key=queue)


async def _handle_message(
    message: AbstractIncomingMessage,
    exchange: AbstractExchange,
    queue: str,
    schema: type[M],
    handler: Handler[M],
    max_retries: int,
) -> None:
    """处理单条消息：解析 → 幂等检查 → 交 handler → 成功标记并确认 / 失败重投后确认。

    全程手动确认：无论成功、失败重投、还是丢弃，最终都显式 ack，确保消息不会卡在未确认状态。
    """
    # 1) 解析校验：非法消息（JSON 损坏或字段不符）无重试意义，直接确认丢弃
    try:
        payload = schema.model_validate_json(message.body)
    except ValidationError as exc:
        logger.error("丢弃非法消息[%s]：%s，body=%r", queue, exc, message.body)
        await message.ack()
        return

    # 2) 幂等去重：已成功处理过的消息（重复投递 / redeliver）直接确认跳过
    if await _already_done(queue, message.message_id):
        logger.info("幂等跳过已处理消息[%s] id=%s", queue, message.message_id)
        await message.ack()
        return

    # 3) 交 handler 处理
    try:
        await handler(payload)
    except Exception as exc:  # noqa: BLE001 业务各类异常统一兜底重试
        retries = _retry_count(message)
        if retries < max_retries:
            logger.warning(
                "消息处理失败[%s]，准备重试 %d/%d，err=%s",
                queue, retries + 1, max_retries, exc,
            )
            await _republish_for_retry(
                exchange, queue, message.message_id, message.body, retries
            )
        else:
            logger.error("消息重试已达上限[%s]，丢弃，err=%s", queue, exc)
        # 原消息确认移除：重投的新消息已接替，或已彻底丢弃
        await message.ack()
        return

    # 4) 成功：先写幂等标记，再确认。即便标记后 ack 前崩溃，redeliver 也会被幂等拦截
    await _mark_done(queue, message.message_id)
    await message.ack()


async def consume(
    queue: str,
    schema: type[M],
    handler: Handler[M],
    *,
    max_retries: int = MAX_RETRIES,
    prefetch: int = PREFETCH_COUNT,
) -> None:
    """通用消费循环：监听 queue，将每条消息解析为 schema 后交 handler 处理。

    自行声明与生产者一致的持久化交换机 / 队列 / 绑定，确保独立进程启动时拓扑存在。

    :param queue: 队列名（durable，即 routing_key，须与生产者绑定一致）
    :param schema: 消息体的 Pydantic 模型
    :param handler: 异步处理函数，抛异常触发重试
    :param max_retries: 最大重投次数
    :param prefetch: 未确认消息上限
    """
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    # publisher_confirms=True：重投消息时同样等 broker 确认（手动发送确认）
    channel = await connection.channel(publisher_confirms=True)
    await channel.set_qos(prefetch_count=prefetch)
    # 声明持久化拓扑
    exchange, q = await declare_topology(channel, settings.mail_exchange, queue)

    logger.info("消费者已启动，监听队列：%s", queue)

    # iterator 默认非自动确认模式，消息由 _handle_message 显式 ack（手动消费确认）
    async with q.iterator() as queue_iter:
        async for message in queue_iter:
            await _handle_message(message, exchange, queue, schema, handler, max_retries)
