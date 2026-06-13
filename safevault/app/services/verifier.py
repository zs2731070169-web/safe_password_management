"""服务端口令慢哈希（注册落库 / 登录比对 / 改密 / 重置的共享实现）。

登录提速方案下，客户端用服务端公钥把**明文密码**非对称封装上送（见 services/seal.py），后端解封得
明文后，由本模块叠加随机 server_salt 用 PBKDF2-HMAC-SHA256 慢哈希一次后落库 / 比对。注册、登录、
改密、重置必须用**完全相同**的算法 / 迭代 / 编码，否则比对永远不中；为消除重复、杜绝实现漂移，
把「生成 server_salt」与「慢哈希口令」抽到此共享模块，四处一律引用这里的函数。

慢哈希的意义：即便账户库泄露，攻击者也无法离线低成本爆破出明文口令（每次猜测都要付出
verifier_hash_iterations 次 PBKDF2 的代价）。salt 每账户独立，防彩虹表 / 撞库。

历史说明：早期为零知识方案，客户端先本地 PBKDF2 派生 verifier 再上送，后端对 verifier 二次哈希；
现已改为「客户端非对称封装明文 → 后端解封 → 慢哈希」，故本模块入参语义由「verifier」变为「明文密码」，
函数名相应改为 hash_password。落库列名 password_verifier 沿用（值即明文口令的服务端慢哈希）。
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


def hash_password(password: str, server_salt: str) -> str:
    """对明文密码叠加 server_salt 做服务端慢哈希，返回 base64 文本。

    用 PBKDF2-HMAC-SHA256（标准库，无重依赖）。salt 取「server_salt 的原始字节」，
    迭代次数走配置 verifier_hash_iterations。输出 32 字节摘要，base64 后存 / 比对
    password_verifier 列。注册落库与登录 / 改密 / 重置比对调用同一函数，保证算法一致。

    :param password: 解封后的明文密码（仅在内存内用于哈希，不留存）
    :param server_salt: 该账户的服务端盐（base64 文本，注册时随机生成并存库）
    :returns: base64 编码的 32 字节慢哈希摘要
    """
    salt_bytes = base64.b64decode(server_salt)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_bytes,
        settings.verifier_hash_iterations,
        dklen=32,
    )
    return base64.b64encode(digest).decode("ascii")
