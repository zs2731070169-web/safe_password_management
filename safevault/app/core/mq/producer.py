"""RabbitMQ 生产者：把任务消息投递到指定队列，主链路不等待实际处理。

连接由 client.mq_client 统一管理（健壮连接，断线自动重连，
FastAPI 在 lifespan 启动时 init_mq、关闭时 close_mq）。

`publish` 为通用入口，接收任意 Pydantic 消息体投递到持久化交换机；
`publish_mail_task` 是发码邮件场景的薄封装，调用方无需关心队列名与序列化细节。

可靠性要点：
  - 消息持久化（PERSISTENT）：broker 重启不丢任务；
  - 唯一 message_id：消费端据此做幂等去重（重投时复用同一 ID）；
  - 经具名持久化交换机 + routing_key=队列名 路由，信道已开 publisher confirms，
    publish 会等 broker 确认收妥（手动发送确认）。
"""
from __future__ import annotations

import uuid

import aio_pika
from pydantic import BaseModel

from client.mq_client import get_exchange


async def publish(queue: str, message: BaseModel) -> None:
    """通用投递：把一个 Pydantic 消息体持久化投递到指定队列。

    经持久化交换机以 routing_key=队列名 直达对应队列；消息持久化（PERSISTENT）确保
    broker 重启不丢任务，并携带唯一 message_id 供消费端幂等。消息体统一序列化为 JSON / UTF-8。
    :param queue: 目标队列名（即 routing_key，须与消费者绑定的队列一致）
    :param message: 任意 Pydantic 模型，作为消息体
    """
    msg = aio_pika.Message(
        body=message.model_dump_json().encode("utf-8"),
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        content_type="application/json",
        message_id=uuid.uuid4().hex,  # 全局唯一 ID，消费端据此去重
    )
    # 信道开启 publisher confirms，await 直到 broker 确认收妥（手动发送确认）
    await get_exchange().publish(msg, routing_key=queue)
