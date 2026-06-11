"""恢复码包裹式密钥 ORM 模型（模块 2/3，决策点 C2 key escrow）。

包裹式密钥（envelope encryption）方案：整库密文由一把**随机 DataKey** 加密（存 OSS），DataKey 再被
**两把**包裹密钥各加密一份独立存放——
  - 「密码包裹的 DataKey」随 backup_blob 一起存（见 models/backup.BackupBlob.wrapped_data_key）；
  - 「恢复码包裹的 DataKey」存于本表 recovery_blob，每账户一份。

如此一来，忘记密码走重置（决策点 C2）时：客户端用恢复码经本表 kdf_params 重算「恢复码包裹密钥」，
解开本表 wrapped_data_key 拿回 DataKey，再用**新密码**重新派生包裹密钥重新包裹、重传 backup_blob——
旧整库密文无需重传即可被新密码解开，避免 C1「接受丢失」的体验代价。

零知识：本表只存恢复码包裹后的 DataKey 密文与其 KDF 配方（明文元信息），后端对密文完全不透明、永不解析。
唯一键 `uk_recovery_account(account_id)` 保证每账户仅一份（覆盖式 UPSERT）。建表据本模型 create_all。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    ForeignKey,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.base.base import Base, TimestampMixin


class RecoveryBlob(Base, TimestampMixin):
    """恢复码包裹的 DataKey：每账户一份，供决策点 C2 重置后用恢复码恢复 DataKey（零知识，覆盖式）。"""

    __tablename__ = "recovery_blob"

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger, "mysql"),
        primary_key=True,
        autoincrement=True,
        comment="主键",
    )

    # 归属云账户（即时序图中的 userId）；外键级联：账户删除时连带清理其恢复 blob。
    # 唯一约束 uk_recovery_account 由下方 __table_args__ 声明，保证每账户仅一份（覆盖式 UPSERT）。
    account_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger, "mysql"),
        ForeignKey("account.id", ondelete="CASCADE"),
        nullable=False,
        comment="归属云账户，鉴权后据此定位（重置时据此取回恢复码包裹的 DataKey）",
    )

    # 「恢复码包裹的 DataKey」密文（base64 文本）。随机 DataKey 被「恢复码派生的包裹密钥」AES-GCM 加密
    # 后的产物。重置（C2）时客户端用恢复码经下方 kdf_params 重算包裹密钥，解开本列拿回 DataKey。
    # 后端零知识、永不解析。用 Text 容纳几十~上百字符的 base64，留足余量。
    wrapped_data_key: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="「恢复码包裹的 DataKey」密文（base64），重置时客户端用恢复码解开它拿回 DataKey",
    )

    # 「恢复码包裹密钥」的 KDF 配方（明文），客户端据此从恢复码重算包裹密钥；后端仅透传存储，不解析语义。
    kdf_params: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        comment="「恢复码包裹密钥」的 KDF 配方（明文），客户端据此从恢复码重算包裹密钥",
    )

    # 每账户仅一份（覆盖式 UPSERT），与 backup_blob 的 uk_backup_account 同构。
    __table_args__ = (
        UniqueConstraint("account_id", name="uk_recovery_account"),
    )

    def __repr__(self) -> str:  # pragma: no cover - 仅调试用
        return f"<RecoveryBlob id={self.id} account_id={self.account_id}>"
