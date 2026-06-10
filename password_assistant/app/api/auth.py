"""认证相关路由。当前实现 §1 下发邮箱验证码，后续 §2~§6 在此扩展。"""
from __future__ import annotations

from fastapi import APIRouter, Request

from schemas.auth import VerifyCodeRequest, VerifyCodeResponse
from services.rate_limit import enforce_send_code_limit
from services.verify_code import send_verify_code

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    """提取客户端 IP：优先取网关透传的 X-Forwarded-For 首段，否则用直连地址。"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/verify-code", response_model=VerifyCodeResponse)
async def verify_code(payload: VerifyCodeRequest, request: Request) -> VerifyCodeResponse:
    """下发邮箱验证码（注册 / 重置共用）。

    流程对齐时序图 §1：限流 → 校验邮箱格式（pydantic 已做）→ 冷却 → 生码写码 → 投递 MQ。
    成功立即返回，不等待邮件实际送达。
    """
    email = payload.email
    # 1) 限流（替代 API 网关）：邮箱 + IP 双维度，超限抛 429
    await enforce_send_code_limit(email, _client_ip(request))
    # 2) 发码编排：冷却命中抛 429，否则写码并投递 MQ
    await send_verify_code(email)
    return VerifyCodeResponse(sent=True)
