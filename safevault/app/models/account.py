"""云账户 ORM 模型（模块 1）。

映射 base/schema.sql 的 `account` 表 —— 应用唯一身份中枢。零知识：只存
password_verifier（服务端再叠加 server_salt 慢哈希后的产物），不存明文、不可还原密钥。
字段定义须与 schema.sql 严格一致（列名 / 类型 / 约束），建表脚本据本模型 create_all。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, BigInteger, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from core.base.base import Base, TimestampMixin


class Account(Base, TimestampMixin):
    """云账户：身份凭据（仅密码验证器，零知识）。"""

    __tablename__ = "account"

    # 账户主键，即时序图中的 userId
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger, "mysql"),
        primary_key=True,
        autoincrement=True,
        comment="账户主键，即时序图中的 userId",
    )

    # 登录邮箱，已归一化（去空格 + 转小写），唯一约束支撑注册查重 / 登录定位
    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
        comment="登录邮箱，已归一化（去空格 + 转小写）",
    )

    # 服务端盐（base64）：用于 password_verifier 的服务端慢哈希；改密 / 重置时更新
    server_salt: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        comment="服务端盐（base64），用于密码验证器的慢哈希",
    )

    # 密码验证器（base64）：客户端 verifier 叠加 server_salt 慢哈希后的结果。
    # 零知识，非明文、不可还原 MasterKey。
    password_verifier: Mapped[str] = mapped_column(
        String(1024),
        nullable=False,
        comment="密码验证器（base64），零知识，非明文、不可还原密钥",
    )

    # 本地密钥派生配方（algorithm/salt/iterations 等），后端仅透传存储，不参与计算
    kdf_params: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        comment="本地密钥派生配方（JSON），后端仅透传，不参与计算",
    )

    # 账户状态：1=正常 0=停用（临时锁定走 Redis fail 计数，不落此字段）
    status: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=1,
        server_default="1",
        comment="账户状态：1=正常 0=停用",
    )

    # 令牌版本号（access token 失效闸）：access 签发时把当前 token_version 写入 payload(tv)，
    # 每次 access 鉴权都比对账户当前值，不一致即拒（统一 401）。改密 / 重置成功时自增 → 旧
    # access **立即失效、零残留窗口**（方案 B 严格立即失效），与 DEL refresh 白名单双管齐下。
    # 默认 1、server_default '1'：存量账户经迁移自动补 1，老 access（无 tv 字段）按缺失视为非法。
    # 鉴权高频读取，运行期缓存到 Redis(tokenver:{userId})，自增时同步刷新缓存（见 services/token.py）。
    token_version: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger, "mysql"),
        nullable=False,
        default=1,
        server_default="1",
        comment="令牌版本号：access 鉴权比对，改密/重置时自增使旧 access 立即失效",
    )

    def __repr__(self) -> str:  # pragma: no cover - 仅调试用
        return f"<Account id={self.id} email={self.email!r}>"
