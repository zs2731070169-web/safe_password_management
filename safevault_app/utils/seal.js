/**
 * 认证密码非对称封装（sealed-box）—— 客户端把明文密码用服务端公钥加密后上送
 *
 * 登录提速方案的客户端一侧：替换原「本地 PBKDF2 派生 verifier」的零知识认证（在 App 的 JSCore +
 * noble 纯 JS 上跑 6 万次 PBKDF2 是登录瓶颈），改为用服务端 X25519 公钥把明文密码做一次性 ECIES
 * 封装（亚毫秒级，无重计算）上送，后端解封后慢哈希比对 / 落库。**保险库的零知识加密与 DataKey 派生
 * 不受影响**——那条链路仍在本地用明文密码完成（见 services/crypto.js、stores/cloudAccount.js）。
 *
 * 封装格式（与后端 services/seal.py 逐字节对齐，**两端实现必须一致**）：
 *     payload = base64( eph_pub(32B) ‖ iv(12B) ‖ ciphertext+tag )
 *   其中：
 *     shared = X25519(eph_priv, server_pub)
 *     key    = HKDF-SHA256(ikm=shared, salt=eph_pub‖server_pub, info="safevault/auth-seal/v1", len=32)
 *     ct     = AES-256-GCM(key, iv, 密码UTF-8)，无 AAD（noble gcm 默认 tag 后置，与后端 AESGCM 同布局）
 *
 * 全程用 @noble（curves 的 x25519 + hashes 的 hkdf/sha256 + ciphers 的 aes-gcm）纯 JS 实现，H5 与 App
 * 走**同一套** noble，保证逐位一致、无 WebCrypto-vs-noble 字节差异；随机源经 cryptoPolyfill 的
 * webcrypto.getRandomValues（App 真机优先基座 CSPRNG）。
 *
 * 临时（ephemeral）密钥每次封装新生成 → 前向保密；公钥经 GET /auth/seal-pubkey 公开下发，公钥公开
 * 不损安全（私钥永不出端）。这是 TLS 之上的纵深防御：明文密码不暴露给 TLS 终止代理 / 访问日志。
 */

import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import { gcm } from '@noble/ciphers/aes'

// 跨端 crypto 句柄：复用与 services/crypto.js / utils/kdf.js 同源的随机源（App=基座CSPRNG/noble，H5=原生）
import { webcrypto } from '@/utils/cryptoPolyfill'

/**
 * 纯 ASCII 串 → Uint8Array（不依赖 TextEncoder）。
 * 用于在**模块加载期**构造常量：App 端（JSCore）的 TextEncoder 由 installCryptoPolyfill 注入为全局，
 * 模块顶层代码在实例上下文创建时即执行、早于 polyfill 生效，此时 `new TextEncoder()` 会抛
 * ReferenceError 致白屏。固定 ASCII 标签用 charCodeAt 逐字节构造即可，无需 TextEncoder。
 */
function asciiToBytes(s) {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/** HKDF info 串：固定上下文标签，须与后端 services/seal.py 完全一致，避免跨用途密钥复用。 */
const HKDF_INFO = asciiToBytes('safevault/auth-seal/v1')
/** AES-GCM 推荐 IV 长度（字节），96 位。 */
const IV_LENGTH = 12
/** X25519 公钥 / 私钥长度（字节）。 */
const X25519_LEN = 32

/** ArrayBuffer / TypedArray → base64 文本（与 services/crypto.js 同款实现，跨端 btoa 等价）。 */
function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** base64 文本 → Uint8Array（用于还原服务端公钥）。 */
function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 用服务端 X25519 公钥把明文密码封装成 base64（供注册 / 登录 / 改密 / 重置上送）。
 *
 * @param {string} plaintext 明文密码（仅本函数内用于加密，不留存、不出端明文）
 * @param {string} serverPubB64 服务端 X25519 公钥（32 字节原始公钥的 base64，来自 GET /auth/seal-pubkey）
 * @returns {string} base64( eph_pub ‖ iv ‖ ciphertext+tag )
 * @throws {Error} 公钥长度非法时
 */
export function sealPassword(plaintext, serverPubB64) {
  const serverPub = base64ToBytes(serverPubB64)
  if (serverPub.length !== X25519_LEN) {
    throw new Error('服务端公钥长度非法')
  }

  // 1) 临时密钥对：私钥取 32 字节随机（x25519 内部自带 clamp），由其推导临时公钥
  const ephPriv = webcrypto.getRandomValues(new Uint8Array(X25519_LEN))
  const ephPub = x25519.getPublicKey(ephPriv)

  // 2) ECDH 共享密钥 → HKDF-SHA256 派生 AES 密钥（salt = eph_pub ‖ server_pub，info 固定标签）
  const shared = x25519.getSharedSecret(ephPriv, serverPub)
  const salt = new Uint8Array(ephPub.length + serverPub.length)
  salt.set(ephPub, 0)
  salt.set(serverPub, ephPub.length)
  const key = hkdf(sha256, shared, salt, HKDF_INFO, 32)

  // 3) AES-256-GCM 加密明文密码（IV 随机前置，ct‖tag 后置，与后端布局一致）
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = gcm(key, iv).encrypt(new TextEncoder().encode(plaintext))

  // 4) 拼装 eph_pub ‖ iv ‖ ct+tag 并整体 base64
  const payload = new Uint8Array(ephPub.length + iv.length + ciphertext.length)
  payload.set(ephPub, 0)
  payload.set(iv, ephPub.length)
  payload.set(ciphertext, ephPub.length + iv.length)
  return bytesToBase64(payload)
}
