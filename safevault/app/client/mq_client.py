"""RabbitMQ 连接管理（生产者侧）。

进程内维护单连接 + 单信道，并在启动时声明持久化拓扑（交换机 + 队列 + 绑定）。
FastAPI 在 lifespan 启动时 init_mq、关闭时 close_mq；worker 进程的消费者另建连接。

可靠性要点：
  - 信道开启 publisher confirms（手动发送确认）：每次 publish 等 broker 确认收妥再返回；
  - 交换机持久化（durable）：取代 AMQP 默认交换机，broker 重启后拓扑仍在；
  - 队列持久化（durable）+ 绑定到交换机，routing_key=队列名（direct 精确路由）。
"""
import aio_pika
from aio_pika.abc import (
    AbstractChannel,
    AbstractExchange,
    AbstractQueue,
    AbstractRobustConnection,
    AbstractRobustChannel,
    AbstractRobustExchange,
)

from config import settings

_connection: AbstractRobustConnection | None = None
_channel: AbstractRobustChannel | None = None
_exchange: AbstractRobustExchange | None = None


async def declare_topology(
    channel: AbstractChannel,
    exchange_name: str,
    queue_name: str,
) -> tuple[AbstractExchange, AbstractQueue]:
    """在给定信道上声明发码链路的持久化拓扑，返回 (交换机, 队列)。

    持久化 direct 交换机 + 持久化队列 + 以 routing_key=队列名 绑定。AMQP 声明是幂等的：
    生产者（init_mq）与消费者（consume）各自连接后都调用本函数，保证无论哪个进程先启动，
    拓扑都已存在且参数一致，二者不必相互依赖启动顺序。
    """
    exchange = await channel.declare_exchange(
        exchange_name, aio_pika.ExchangeType.DIRECT, durable=True
    )
    queue = await channel.declare_queue(queue_name, durable=True)
    await queue.bind(exchange, routing_key=queue_name)
    return exchange, queue


async def init_mq() -> None:
    """建立连接与信道，并声明持久化的交换机 / 队列 / 绑定。"""
    global _connection, _channel, _exchange
    if _connection is None:
        _connection = await aio_pika.connect_robust(settings.rabbitmq_url)
        # publisher_confirms=True：发送确认模式，publish 会等待 broker ack（手动发送确认）
        _channel = await _connection.channel(publisher_confirms=True)
        # 声明持久化拓扑（交换机 / 队列 / 绑定）
        _exchange, _ = await declare_topology(
            _channel, settings.mail_exchange, settings.mail_queue
        )


def get_channel() -> AbstractRobustChannel:
    """获取已初始化的信道；未初始化则抛错提醒先 init_mq()。"""
    if _channel is None:
        raise RuntimeError("RabbitMQ 尚未初始化，请先调用 init_mq()")
    return _channel


def get_exchange() -> AbstractRobustExchange:
    """获取已声明的持久化交换机；未初始化则抛错提醒先 init_mq()。"""
    if _exchange is None:
        raise RuntimeError("RabbitMQ 尚未初始化，请先调用 init_mq()")
    return _exchange


async def close_mq() -> None:
    """关闭信道与连接，供 lifespan 收尾调用。"""
    global _connection, _channel, _exchange
    if _connection is not None:
        await _connection.close()
        _connection = None
        _channel = None
        _exchange = None
