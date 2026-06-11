"""Brevo（原 Sendinblue）事务邮件发送（HTTP API）。

通过 Brevo 的 /v3/smtp/email 接口发验证码邮件。Brevo 注册免信用卡，验证一个发件
邮箱（BREVO_SENDER_EMAIL）即可给任意收件人发；如需更高投递率 / 额度，可在 Brevo
后台进一步验证自有域名。发码消费者（comsumer/mail.py）直接调用本模块。

httpx 同步客户端调用，消费者侧已用线程池包裹避免阻塞事件循环。
"""
from __future__ import annotations

import logging

import httpx

from config import settings
from worker.template import render_verify_code_html

logger = logging.getLogger("safevault.mail")

# Brevo 事务邮件接口（固定）
_API_URL = "https://api.brevo.com/v3/smtp/email"


def send_verify_code_mail(email: str, code: str) -> None:
    """通过 Brevo 同步发送一封验证码邮件，失败抛异常交由调用方（MQ 消费者）决定重试。

    :param email: 收件邮箱
    :param code: 6 位验证码
    """
    payload = {
        "sender": {"name": settings.brevo_sender_name, "email": settings.brevo_sender_email},
        "to": [{"email": email}],
        "subject": "【SafeVault】您的验证码",
        "htmlContent": render_verify_code_html(code),
    }
    headers = {
        "api-key": settings.brevo_api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    # trust_env=False：发信不隐式读取系统代理环境变量（避免本机 ALL_PROXY 的 socks 代理
    # 被误用导致缺 socksio 报错，也避免生产机莫名继承代理）；是否走代理仅由 settings.mail_proxy 决定。
    with httpx.Client(trust_env=False, proxy=settings.mail_proxy or None, timeout=10) as client:
        resp = client.post(_API_URL, json=payload, headers=headers)
    resp.raise_for_status()  # 非 2xx 抛 HTTPStatusError，交由消费者重试
    message_id = resp.json().get("messageId")
    logger.info("验证码邮件已提交 Brevo，to=%s message_id=%s", email, message_id)
