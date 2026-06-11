"""建表脚本（幂等，未引入 Alembic，统一 create_all）。

用法（在 app/ 目录下）：
    uv run python -m core.base.init_db

连接 settings.database_url 指向的 MySQL → 对「已注册的所有 ORM 模型」执行 create_all
（已存在的表跳过，幂等）→ 退出。应用启动时 main.py 的 lifespan **不**自动建表，首次部署 /
新增表后需手动跑本脚本。

注册模型：下方显式 import 各 models.* 模块，使其 ORM 类在 import 时注册到
``Base.metadata``，create_all 才能收集到对应表。**新增模型务必在此 import 一行**，否则
建表脚本不会为它建表。当前已注册：
  - account     → account 表（模块 1 云账户与认证）
  - backup_blob → backup_blob 表（模块 2 加密备份元信息）
"""
from __future__ import annotations

import asyncio
import logging

from client.db_client import close_db, init_db
from core.base.base import Base

# —— 注册 ORM 模型（import 即注册到 Base.metadata；create_all 据此建表）——
# 仅为副作用导入，故用 noqa 抑制「未使用」告警。新增模型在此补一行同款 import。
from models.account import Account  # noqa: F401
from models.backup import BackupBlob  # noqa: F401

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("safevault.init_db")


async def _create_all() -> None:
    """连接数据库并对所有已注册模型执行 create_all（幂等）。"""
    engine = await init_db()
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        tables = ", ".join(sorted(Base.metadata.tables.keys()))
        logger.info("建表完成（幂等）。已注册表：%s", tables)
    finally:
        await close_db()


def main() -> None:
    """脚本入口：python -m core.base.init_db。"""
    asyncio.run(_create_all())


if __name__ == "__main__":
    main()
