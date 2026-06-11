"""加密备份元信息 ORM 模型（模块 2）。

映射 db/schema.sql 的 `backup_blob` 表 —— 每账户一份「整库密文快照」的权威指针。
零知识：整库 AES-GCM 密文本体存阿里云 OSS（对象 key = `backup/{account_id}`，覆盖写），
本表只存指向该对象的明文元信息（object_key/version/checksum/size/kdf_params），
服务端对密文完全不透明，永不解析。

字段定义须与 schema.sql 严格一致（列名 / 类型 / 约束），建表脚本据本模型 create_all。
唯一键 `uk_backup_account(account_id)` 保证每账户仅一份最新快照（覆盖式上传）。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    CHAR,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.base.base import Base, TimestampMixin


class BackupBlob(Base, TimestampMixin):
    """加密备份元信息：每账户一份整库密文快照的指针（密文存 OSS，零知识，覆盖式）。"""

    __tablename__ = "backup_blob"

    # 主键
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger, "mysql"),
        primary_key=True,
        autoincrement=True,
        comment="主键",
    )

    # 归属云账户（即时序图中的 userId）；外键级联：账户删除时连带清理其备份元信息。
    # 唯一约束 uk_backup_account 由下方 __table_args__ 声明，保证每账户仅一份（覆盖式上传）。
    account_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger, "mysql"),
        ForeignKey("account.id", ondelete="CASCADE"),
        nullable=False,
        comment="归属云账户，鉴权后据此定位（换机后同账户登录即可取回）",
    )

    # 密文 blob 在 OSS 的对象 key（如 backup/123）；密文本体存 OSS 不进本表
    object_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="密文 blob 在 OSS 的对象 key（如 backup/123）；密文本体存 OSS 不进本表",
    )

    # 「密码包裹 DataKey」的 KDF 配方（明文）。包裹式密钥（envelope encryption）方案下，整库密文由
    # 一把随机 DataKey 加密，DataKey 再被「密码派生的包裹密钥」加密后存于下方 wrapped_data_key 列；
    # 本列即记录「从云账户密码派生出该包裹密钥」所需的派生配方（algorithm/salt/iterations/length 等）。
    # 换机后客户端据此重算包裹密钥 → 解开 wrapped_data_key 拿回 DataKey → 解密整库。后端仅透传，不解析。
    kdf_params: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        comment="「密码包裹 DataKey」的 KDF 配方（明文），客户端据此重算包裹密钥解开 wrapped_data_key",
    )

    # 「密码包裹的 DataKey」密文（base64 文本）。随机 DataKey 被「密码派生的包裹密钥」AES-GCM 加密后的
    # 产物，与整库 ciphertext 一同构成包裹式密钥方案：换机后客户端用密码经上方 kdf_params 重算包裹密钥，
    # 解开本列拿回 DataKey，再解密 OSS 上的整库密文。后端零知识、永不解析。开发期 nullable=True 以兼容
    # 尚未携带该字段的历史/过渡数据；上传链路恒会写入。用 Text 容纳几十~上百字符的 base64，留足余量。
    wrapped_data_key: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="「密码包裹的 DataKey」密文（base64），客户端用密码派生密钥解开它拿回 DataKey",
    )

    # 单调递增版本号；服务端拒绝旧版本覆盖新版本（防回退 / 并发误写）
    version: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger, "mysql"),
        nullable=False,
        comment="单调递增版本号；服务端拒绝旧版本覆盖新版本（防回退/并发误写）",
    )

    # ciphertext 的 SHA-256 十六进制摘要（64 位 hex）。零知识下后端不重算 / 不比对密文真实哈希
    # （无法解析密文），只校验其格式合法性后原样存储，校验未损坏由客户端下载时自行完成。
    checksum: Mapped[str] = mapped_column(
        CHAR(64),
        nullable=False,
        comment="ciphertext 的 SHA-256 十六进制摘要，校验传输/存储未损坏",
    )

    # 密文字节数（base64 解码后的原始长度），供 GET /backup/meta 展示与计费
    size_bytes: Mapped[int] = mapped_column(
        Integer().with_variant(Integer, "mysql"),
        nullable=False,
        default=0,
        server_default="0",
        comment="密文字节数，供 GET /backup/meta 展示与计费",
    )

    # 是否可解密：保留字段。决策点已从 C1 切到 C2（恢复码包裹式密钥），重置密码后旧 blob 仍可经恢复码
    # 解出 DataKey 并以新密码重新包裹，故**重置不再把本列置 0**；上传时恒置 1。当前无置 0 路径，留作未来
    # 「显式作废某份 blob」的扩展位（如用户主动清云备份）。
    valid: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=1,
        server_default="1",
        comment="是否可解密：恒置 1（C2 方案下重置不再置 0，旧 blob 可经恢复码恢复）；保留作未来作废位",
    )

    # 每账户仅一份最新快照（覆盖式），与 schema.sql 的 uk_backup_account 一致
    __table_args__ = (
        UniqueConstraint("account_id", name="uk_backup_account"),
    )

    def __repr__(self) -> str:  # pragma: no cover - 仅调试用
        return f"<BackupBlob id={self.id} account_id={self.account_id} version={self.version}>"
