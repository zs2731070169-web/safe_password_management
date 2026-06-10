"""下发邮箱验证码的业务编排（对齐时序图 §1 认证服务部分）。

严格按时序图顺序：查冷却 → 生成 6 位码 → 写码(TTL 300s) + 写冷却(60s) → 投递 MQ。
限流由调用方（路由层）先行处理，此处只管发码本身的冷却与下发。
"""
from __future__ import annotations

import secrets

from config import settings
from core.exception.exceptions import CooldownError
from core.mq import producer
from client.redis_client import get_redis
from schemas.mq import MailVerifyCodeTask


def _code_key(email: str) -> str:
    return f"code:{email}"


def _cooldown_key(email: str) -> str:
    return f"cooldown:{email}"


def _generate_code() -> str:
    """生成 6 位数字验证码，使用密码学安全随机源，左补零。"""
    return f"{secrets.randbelow(1_000_000):06d}"


async def send_verify_code(email: str) -> None:
    """下发验证码主流程。

    :param email: 已归一化（小写、去空格）的目标邮箱
    :raises CooldownError: 处于 60s 发码冷却期内
    """
    redis = get_redis()

    # 1) 冷却检查：命中即拒，对齐时序图 429「请稍后再试」
    if await redis.get(_cooldown_key(email)):
        raise CooldownError("请稍后再试", status_code=429)

    # 2) 生成验证码
    code = _generate_code()

    # 3) 写码与冷却：用 pipeline 一次往返
    pipe = redis.pipeline()
    await pipe.setex(_code_key(email), settings.code_ttl, code)
    await pipe.setex(_cooldown_key(email), settings.cooldown_ttl, "1")
    await pipe.execute()

    # 4) 投递 MQ 异步发信，主链路不等邮件实际送达
    await producer.publish(settings.mail_queue, MailVerifyCodeTask(email=email, code=code))
