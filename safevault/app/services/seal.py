"""认证密码非对称封装（sealed-box）的服务端解封实现。

登录提速方案的服务端一侧：客户端不再在本地跑 PBKDF2 派生 verifier，而是用服务端 X25519 公钥把
**明文密码**封装（ECIES）后上送；后端用本模块的私钥解封得到明文，再交由 services/password_hash
慢哈希比对 / 落库。保险库的零知识加密与 DataKey 派生不受影响（仍全在客户端本地完成）。

封装格式（与前端 utils/seal.js 逐字节对齐，**两端实现必须一致**）：
    payload = base64( eph_pub(32B) ‖ iv(12B) ‖ ciphertext+tag )
  其中：
    shared = X25519(eph_priv, server_pub)            # 客户端用临时私钥 + 服务端公钥
           = X25519(server_priv, eph_pub)            # 服务端用本私钥 + 客户端临时公钥（同一共享密钥）
    key    = HKDF-SHA256(ikm=shared, salt=eph_pub‖server_pub, info=b"safevault/auth-seal/v1", len=32)
    ct     = AES-256-GCM(key, iv, plaintext=密码UTF-8, aad=None)   # noble gcm 默认 tag 后置，与本实现一致

安全说明：
  - 临时（ephemeral）密钥每次封装新生成 → 前向保密：单次会话密钥泄露不波及历史；
  - 公钥经 GET /auth/seal-pubkey 公开下发，公钥公开不损安全（私钥永不出端）；
  - 这是 TLS 之上的纵深防御：密码不暴露给 TLS 终止代理 / 访问日志 / 应用层边界明文。
"""
from __future__ import annotations

import base64

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)

from config import settings
from core.exception.exceptions import SealDecryptError

# HKDF info 串：固定上下文标签，须与前端 utils/seal.js 完全一致，避免跨用途密钥复用。
_HKDF_INFO = b"safevault/auth-seal/v1"
# 各段定长（字节）：X25519 公钥 32、AES-GCM 推荐 IV 12。
_EPH_PUB_LEN = 32
_IV_LEN = 12
# GCM tag 16B 后置于密文：解密时由 AESGCM 自行处理，此处仅用于最小长度校验。
_MIN_PAYLOAD_LEN = _EPH_PUB_LEN + _IV_LEN + 16


def _load_private_key() -> X25519PrivateKey:
    """从配置加载服务端 X25519 私钥（base64 的 32 字节原始私钥）。

    每次调用重新构造（X25519PrivateKey 轻量；避免模块级缓存掩盖配置热更新）。
    配置缺失 / 非法长度直接抛 ValueError，属部署期错误（启动即暴露，不进运行期）。
    """
    raw = base64.b64decode(settings.seal_private_key)
    if len(raw) != 32:
        raise ValueError("seal_private_key 必须是 32 字节原始 X25519 私钥的 base64")
    return X25519PrivateKey.from_private_bytes(raw)


def get_server_public_key_b64() -> str:
    """返回服务端 X25519 公钥（32 字节原始公钥的 base64），供 GET /auth/seal-pubkey 下发。"""
    pub = _load_private_key().public_key()
    raw = pub.public_bytes_raw()
    return base64.b64encode(raw).decode("ascii")


def decrypt_sealed(payload_b64: str) -> str:
    """解封客户端上送的密码封装，返回明文密码（UTF-8）。

    任何环节失败（base64 非法 / 长度不足 / GCM 校验不过 / 非 UTF-8）一律抛 SealDecryptError(400)，
    不区分具体原因，避免给攻击者构造性反馈（与登录统一 401 的防探测思路一致）。

    :param payload_b64: base64(eph_pub ‖ iv ‖ ciphertext+tag)
    :returns: 明文密码
    :raises SealDecryptError: 解封失败（格式非法 / 校验不过）
    """
    try:
        payload = base64.b64decode(payload_b64, validate=True)
        if len(payload) < _MIN_PAYLOAD_LEN:
            raise ValueError("封装长度不足")

        eph_pub = payload[:_EPH_PUB_LEN]
        iv = payload[_EPH_PUB_LEN : _EPH_PUB_LEN + _IV_LEN]
        ciphertext = payload[_EPH_PUB_LEN + _IV_LEN :]

        private_key = _load_private_key()
        server_pub = private_key.public_key().public_bytes_raw()

        # ECDH：用本私钥 + 客户端临时公钥还原共享密钥（与客户端 eph_priv + server_pub 等价）
        shared = private_key.exchange(X25519PublicKey.from_public_bytes(eph_pub))

        # HKDF-SHA256 派生 AES 密钥：salt = eph_pub ‖ server_pub，info 固定标签（与前端一致）
        key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=eph_pub + server_pub,
            info=_HKDF_INFO,
        ).derive(shared)

        plaintext = AESGCM(key).decrypt(iv, ciphertext, None)
        return plaintext.decode("utf-8")
    except SealDecryptError:
        raise
    except Exception as exc:  # noqa: BLE001 — 统一收口为业务异常，不泄露具体失败原因
        raise SealDecryptError("密码封装无效") from exc
