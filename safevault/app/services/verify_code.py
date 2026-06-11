"""邮箱验证码的下发与校验（对齐时序图 §1 发码 / §2 注册 §6 重置的验证码校验）。

本模块聚合「验证码」全生命周期的服务端逻辑，集中一处避免散落漂移：
  - send_verify_code：§1 下发——查冷却 → 生成 6 位码 → 写码(TTL 300s) + 写冷却(60s) → 投递 MQ。
  - verify_code：§2 注册 / §6 重置共用的校验——GET code:{email} 恒定时间比对，缺失 / 不符抛 400。
两侧共用同一 _code_key，杜绝读写 key 不一致。限流由调用方（路由层）先行处理，此处不重复。
"""
from __future__ import annotations

import secrets

from config import settings
from core.exception.exceptions import CooldownError, InvalidCodeError
from core.mq import producer
from client.redis_client import get_redis
from schemas.mq import MailVerifyCodeTask


def _code_key(email: str) -> str:
    return f"code:{email}"


async def verify_code(email: str, code: str) -> None:
    """校验邮箱验证码（注册 §2 步骤 3 / 重置 §6 步骤 2 共用）。缺失 / 不符均抛 InvalidCodeError(400)。

    用恒定时间比较（secrets.compare_digest）避免时序侧信道泄露验证码内容。注册与重置共用此一份
    实现：单点修改、不存在两处算法漂移导致一处能验、另一处验不过。**不在此删除验证码**——
    「用后即焚」（DEL code:{email}）由各编排在落库成功后再做，确保校验通过但后续步骤失败时
    验证码不会被提前消费。

    :param email: 已归一化（小写、去空格）邮箱
    :param code: 客户端提交的验证码
    :raises InvalidCodeError: 验证码缺失 / 不符（400「验证码错误或已过期」）
    """
    redis = get_redis()
    stored = await redis.get(_code_key(email))
    # 同一句覆盖「缺失」与「不符」两种情形，对外提示一致（不区分以免被探测邮箱是否发过码）
    if not stored or not secrets.compare_digest(stored, code):
        raise InvalidCodeError("验证码错误或已过期")


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
