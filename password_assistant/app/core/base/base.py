"""SQLAlchemy 2.0 声明式基类与公共 Mixin。

所有 ORM 模型继承 Base；时间戳列抽到 TimestampMixin，与 schema.sql 的
created_at / updated_at（DEFAULT CURRENT_TIMESTAMP [ON UPDATE]）语义一致，
具体默认值由数据库侧负责，应用层不显式赋值。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """声明式模型基类。models/ 下所有实体继承自此，统一被 create_all 收集建表。"""


class TimestampMixin:
    """通用时间戳列：创建时间 + 最后更新时间。

    - created_at：插入时由库侧 CURRENT_TIMESTAMP 填充。
    - updated_at：插入时填充，且 ON UPDATE 自动刷新（改密 / 重置时随之更新）。
    与 base/schema.sql 中 account 表的两列定义保持一致。
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="创建时间",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),  # 应用层 UPDATE 时同步刷新，兜底库侧 ON UPDATE
        nullable=False,
        comment="最后更新时间",
    )
