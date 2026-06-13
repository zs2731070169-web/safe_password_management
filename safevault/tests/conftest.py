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
import os
from collections.abc import AsyncGenerator
from typing import Any

import fakeredis.aioredis
import pytest_asyncio
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import client.db_client as db_client
import client.redis_client as redis_client
from core.base.base import Base
from models.account import Account
from services.seal import get_server_public_key_b64
from services.verifier import generate_server_salt, hash_password


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


def seal_password(plaintext: str) -> str:
    """模拟前端：用服务端公钥把明文密码非对称封装（ECIES）成 base64，供注册/登录/改密/重置测试上送。

    构造与 services/seal.py 逐字节对齐（X25519 ECDH → HKDF-SHA256 → AES-256-GCM）：
        payload = base64( eph_pub(32) ‖ iv(12) ‖ ct+tag )
    服务端 decrypt_sealed 用本进程同一私钥即可解封回明文，验证端到端可用。
    """
    server_pub_raw = base64.b64decode(get_server_public_key_b64())
    eph = X25519PrivateKey.generate()
    eph_pub = eph.public_key().public_bytes_raw()
    shared = eph.exchange(X25519PublicKey.from_public_bytes(server_pub_raw))
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=eph_pub + server_pub_raw,
        info=b"safevault/auth-seal/v1",
    ).derive(shared)
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), None)
    return base64.b64encode(eph_pub + iv + ct).decode("ascii")


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
    """在库里建一个账户，返回 (account, 明文密码)。

    模拟注册落库（认证已改为非对称封装上送密码）：生成 server_salt → 对**明文密码**服务端慢哈希
    存 password_verifier。返回的明文密码供测试用 seal_password 封装后作为 sealed_* 上送。

    :returns: (已 flush 的 account 实体, 明文密码)
    """
    global _next_account_id
    account_id = _next_account_id
    _next_account_id += 1

    server_salt = generate_server_salt()
    account = Account(
        id=account_id,  # 显式赋 id，绕开 SQLite 对 BIGINT 主键不自增的方言差异
        email=email,
        server_salt=server_salt,
        password_verifier=hash_password(password, server_salt),
        kdf_params={"scheme": "sealed-v1"},  # 认证零知识废除后该列仅留标记，不参与计算
        status=1,
        token_version=token_version,
    )
    session.add(account)
    await session.flush()
    return account, password


def make_kdf_params(salt: str) -> dict[str, Any]:
    """构造一份 kdf_params 占位（仅 salt 区分），供**备份 blob** 上传测试使用（与认证无关）。"""
    return {"algorithm": "pbkdf2", "salt": salt, "iterations": 200000}
