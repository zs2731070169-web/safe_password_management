"""认证模块的请求 / 响应模型。"""
from pydantic import BaseModel, EmailStr, field_validator


class VerifyCodeRequest(BaseModel):
    """下发验证码请求体。EmailStr 自动校验邮箱格式，非法直接 422。"""

    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        """归一化：去首尾空格并转小写，避免大小写 / 空格导致的同邮箱多记录。"""
        return v.strip().lower()


class VerifyCodeResponse(BaseModel):
    """下发验证码响应体，对齐时序图 200 { sent: true }。"""

    sent: bool = True
