"""MQ 消息体模型：生产者与消费者之间的契约。

每种队列任务对应一个 Pydantic 模型，收发两端共用同一字段定义，
避免裸 dict 各写各的字段名导致拼写/结构漂移。序列化与校验交给通用的
core.mq.producer / core.mq.consumer 用标准 Pydantic 方法处理，模型本身只描述结构。
"""
from __future__ import annotations

from pydantic import BaseModel, EmailStr

__all__ = ["MailVerifyCodeTask"]


class MailVerifyCodeTask(BaseModel):
    """「发送验证码邮件」任务消息体。

    producer 投递、consumer 消费均以此为准。仅含投递所需的最小字段。
    """

    email: EmailStr  # 收件邮箱（已在上游归一化为小写、去空格）
    code: str        # 6 位验证码
