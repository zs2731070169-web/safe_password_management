"""pytest 公共夹具（fixtures）。

测试目标是验证「方案 B 严格立即失效」这条认证链路的真实行为，故**不 mock** 数据库与
Redis 的读写语义，而是用轻量替身跑真链路：
  - 数据库：内存 SQLite（aiosqlite 异步驱动）+ Base.metadata.create_all 真实建表，验证
    token_version 自增、verifier / server_salt / kdf_params 真实落库。SQLite 与 MySQL 的差异
    （类型、ON UPDATE）不影响本模块要验证的「自增 + 比对 + 失效」逻辑。
  - Redis：fakeredis 内存实现（decode_responses=True，与生产 redis_client 同配置），验证
    refresh 白名单 SADD/SISMEMBER/SREM/DEL 与 tokenver:{userId} 缓存的真实读写。

注入方式：直接给 db_client / redis_client 两个模块的「模块级单例」赋值替身——与生产代码
取连接的路径（get_session_factory / get_redis）完全一致，业务代码无感、零分支。每个测试函数
用独立的内存库与独立的 fakeredis，互不串扰（function 作用域）。
"""
from __future__ import annotations

import base64
from collections.abc import AsyncGenerator
from typing import Any

import fakeredis.aioredis
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import client.db_client as db_client
import client.redis_client as redis_client
from core.base.base import Base
from models.account import Account
from services.verifier import generate_server_salt, hash_verifier


@pytest_asyncio.fixture
async def db_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    """内存 SQLite 引擎 + 会话工厂，并把工厂注入 db_client 模块单例。

    建表用 ORM 的 Base.metadata（与生产 create_all 同源），故 account.token_version 等列
    与模型定义严格一致。注入 db_client._engine / _session_factory 后，业务代码里
    get_session_factory() / rotate 内的局部 import 都拿到本测试的 sqlite 工厂。
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)

    # 注入模块级单例：与生产取连接路径一致，业务代码无需感知测试环境
    db_client._engine = engine
    db_client._session_factory = factory
    try:
        yield factory
    finally:
        db_client._engine = None
        db_client._session_factory = None
        await engine.dispose()


@pytest_asyncio.fixture
async def session(
    db_factory: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncSession, None]:
    """一个事务化会话，供测试直接读写账户。提交由测试内 flush/commit 控制。"""
    async with db_factory() as s:
        yield s
        # 测试结束回滚未提交改动，避免跨用例污染（每用例本就独立内存库，双保险）
        await s.rollback()


@pytest_asyncio.fixture
async def fake_redis() -> AsyncGenerator[fakeredis.aioredis.FakeRedis, None]:
    """fakeredis 替身并注入 redis_client 模块单例（decode_responses=True，与生产同配置）。"""
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    redis_client._client = client
    try:
        yield client
    finally:
        redis_client._client = None
        await client.aclose()


def _verifier_from_password(password: str) -> str:
    """把测试用「明文密码」确定性映射成一个合法的 client verifier（base64，≥16 字节）。

    真实链路里 verifier 由前端 KDF 派生；测试只需一个「同密码恒等、不同密码相异、长度达标」
    的占位 verifier 即可驱动服务端二次慢哈希。用 password 的字节左填充到 24 字节再 base64。
    """
    raw = password.encode("utf-8")
    padded = raw.ljust(24, b"\x00")  # 保证 base64 后长度 ≥16，满足 schema 的 min_length
    return base64.b64encode(padded).decode("ascii")


# 测试账户 id 自增计数器。SQLite 仅对 INTEGER PRIMARY KEY 自动生成主键，本项目主键映射为
# BIGINT（贴合 MySQL），在 SQLite 下不会自增；故测试侧显式赋唯一 id，绕开该方言差异
# （不影响业务代码：生产 MySQL 由 AUTO_INCREMENT 负责）。
_next_account_id = 1000


async def create_account(
    session: AsyncSession,
    *,
    email: str = "user@example.com",
    password: str = "OldPass@2024",
    token_version: int = 1,
) -> tuple[Account, str]:
    """在库里建一个账户，返回 (account, 该密码对应的 client verifier)。

    模拟注册落库：生成 server_salt → 对 client verifier 二次慢哈希存 password_verifier。
    返回的 client verifier 即「客户端用该明文密码派生的产物」，测试改密时作为 old_verifier 传入。

    :returns: (已 flush 的 account 实体, 该密码的 client verifier)
    """
    global _next_account_id
    account_id = _next_account_id
    _next_account_id += 1

    client_verifier = _verifier_from_password(password)
    server_salt = generate_server_salt()
    account = Account(
        id=account_id,  # 显式赋 id，绕开 SQLite 对 BIGINT 主键不自增的方言差异
        email=email,
        server_salt=server_salt,
        password_verifier=hash_verifier(client_verifier, server_salt),
        kdf_params={"algorithm": "pbkdf2", "salt": "old", "iterations": 200000},
        status=1,
        token_version=token_version,
    )
    session.add(account)
    await session.flush()
    return account, client_verifier


def client_verifier_for(password: str) -> str:
    """对外暴露密码→client verifier 的映射，便于测试构造新密码 / 错误旧密码。"""
    return _verifier_from_password(password)


def make_kdf_params(salt: str) -> dict[str, Any]:
    """构造一份新 kdf_params（仅 salt 区分新旧），模拟换新 client salt。"""
    return {"algorithm": "pbkdf2", "salt": salt, "iterations": 200000}
