"""发码邮件消费者（独立进程）。

组装「发码邮件」这一具体业务：把队列 `settings.mail_queue` 的消息解析为
`MailVerifyCodeTask`，交由 Brevo 实际发信。连接、声明、解析、重试、
确认等通用机制全部委托给 `core.mq.consumer.consume`，本模块只关心业务 handler。

启动：python -m comsumer.mail
"""
from __future__ import annotations

import asyncio
import logging

from config import settings
from client.redis_client import init_redis, close_redis
from core.mq.consumer import consume
from schemas.mq import MailVerifyCodeTask
from worker.brevo_mail import send_verify_code_mail

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("safevault.consumer.mail")


async def _send_verify_code_mail(task: MailVerifyCodeTask) -> None:
    """发码邮件 handler：httpx 调用 Brevo HTTP API（同步），放线程池避免阻塞事件循环。"""
    await asyncio.to_thread(send_verify_code_mail, task.email, task.code)


async def main() -> None:
    """启动发码邮件消费者，直到进程被终止。"""
    # 幂等去重依赖 Redis：消费循环前先建连接，进程退出时释放
    await init_redis()
    try:
        await consume(settings.mail_queue, MailVerifyCodeTask, _send_verify_code_mail)
    finally:
        await close_redis()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("邮件消费者已停止")
