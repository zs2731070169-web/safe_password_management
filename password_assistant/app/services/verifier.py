"""密码验证器服务端二次哈希（零知识落库 / 登录比对的共享实现）。

注册（§2）落库与登录（§3）比对必须用**完全相同**的算法 / 迭代 / 编码，否则
登录时重算的哈希永远比不中库里的 password_verifier。为消除重复、杜绝两处实现漂移，
把「生成 server_salt」与「叠加 server_salt 慢哈希 verifier」抽到此共享模块，
register / login 一律引用这里的函数。

零知识：传入的 `verifier` 已是「客户端本地用明文密码派生」的产物（后端拿不到明文）；
再叠加随机 server_salt 用 PBKDF2-HMAC-SHA256 慢哈希一次，库泄露也无法离线还原 verifier。
"""
from __future__ import annotations

import base64
import hashlib
import secrets

from config import settings


def generate_server_salt() -> str:
    """生成 16 字节随机服务端盐，base64 文本存库（与 schema.sql 注释一致）。

    :returns: base64 编码的 16 字节随机盐
    """
    return base64.b64encode(secrets.token_bytes(16)).decode("ascii")


def hash_verifier(verifier: str, server_salt: str) -> str:
    """对客户端 verifier 叠加 server_salt 做服务端慢哈希，返回 base64 文本。

    用 PBKDF2-HMAC-SHA256（标准库，无重依赖）。salt 取「server_salt 的原始字节」，
    迭代次数走配置。输出 32 字节摘要，base64 后存 / 比对 password_verifier 列。
    注册落库与登录比对调用同一函数，保证算法一致。

    :param verifier: 客户端本地派生的密码验证器（base64 文本，非明文）
    :param server_salt: 该账户的服务端盐（base64 文本，注册时随机生成并存库）
    :returns: base64 编码的 32 字节慢哈希摘要
    """
    salt_bytes = base64.b64decode(server_salt)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        verifier.encode("utf-8"),
        salt_bytes,
        settings.verifier_hash_iterations,
        dklen=32,
    )
    return base64.b64encode(digest).decode("ascii")
