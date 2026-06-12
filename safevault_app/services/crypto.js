/**
 * 加密备份密钥与整库加解密（零知识）—— 模块 2 PUT /backup 的客户端密码学底座
 *
 * 职责：把「云账户密码」就地派生成 DataKey，并用 AES-GCM 对整库快照加解密，产出后端契约要求的
 * `{ ciphertext, kdfParams, checksum }`。**明文密码与明文库永不出端**，后端只见密文与派生配方。
 *
 * 密钥方案（直接派生，务实选型）：
 *   DataKey = PBKDF2-HMAC-SHA256(账户密码, backupSalt)  →  AES-GCM-256 密钥
 *   ciphertext = AES-GCM(DataKey, JSON(整库快照))，载荷 = IV(12B) ‖ 密文+Tag，整体 base64
 *   checksum = SHA-256(载荷字节) 的十六进制（64 位），后端只校验格式、不重算（拿不到密钥）
 * 换机恢复（GET /backup，后续接口）：后端回传 kdfParams + ciphertext，凭同一账户密码 + kdfParams
 * 重算出同一 DataKey 即可解密，无需任何额外托管，零知识不破。
 *
 * 为何不用「MasterKey 包裹随机 DataKey」（SDD §三 的理想式）：包裹式要在换机端拿到「被包裹的
 * DataKey」才解得开，而存放它的 recovery-blob（key escrow）属模块 3（决策点 C2），本次不在范围。
 * 没有 recovery-blob 时包裹式反而无法换机恢复。故先用直接派生（同样零知识、可换机恢复）；
 * 代价是改密后 DataKey 变化、需重新加密整库——下次库变更自动重传覆盖即可（与 C1 语义一致）。
 * 待模块 3 接入恢复凭据后，可平滑迁移到包裹式以免改密重传。
 *
 * 依赖跨端 crypto 句柄 `webcrypto`（App = noble 垫片 / H5 = 原生 WebCrypto），两端逐位互通；
 * 与 utils/kdf.js 同源。**不再裸写全局 `crypto`**——真机基座预置的 `crypto` 全局无法被垫片覆盖，
 * 裸用会取到残缺 subtle（详见 utils/cryptoPolyfill.js 顶部说明）。
 */

// 跨端 crypto 句柄：替代裸全局 crypto，保证 App 真机一定拿到可用的 subtle / getRandomValues
import { webcrypto } from '@/utils/cryptoPolyfill'

/** 派生 / 加密算法标识，写入 kdfParams 供换机端识别配方 */
const BACKUP_ALGORITHM = 'AES-GCM-PBKDF2-SHA256'
/** PBKDF2 迭代次数：与 utils/kdf.js 同档，兼顾移动端耗时与抗离线爆破 */
const PBKDF2_ITERATIONS = 60000
/** DataKey 长度（字节），32 字节 = AES-256 */
const KEY_LENGTH = 32
/** backup salt 长度（字节） */
const SALT_LENGTH = 16
/** AES-GCM 推荐 IV 长度（字节），96 位 */
const IV_LENGTH = 12

// --------------------------------------------------------------------------- //
// 编码工具：字节 ↔ base64 / hex
// --------------------------------------------------------------------------- //
/** ArrayBuffer / TypedArray → base64 文本 */
function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** base64 文本 → Uint8Array */
function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Uint8Array → 十六进制小写字符串（用于 checksum） */
function bytesToHex(bytes) {
  let hex = ''
  for (let i = 0; i < bytes.byteLength; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

/** 对字节算 SHA-256 十六进制摘要（64 位 hex），对齐后端 checksum 格式校验 */
async function sha256Hex(bytes) {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}

// --------------------------------------------------------------------------- //
// 对外 API
// --------------------------------------------------------------------------- //
/**
 * 生成一份新的备份派生配方（随机 backup salt）。每账户首次备份时产生一次并持久化复用，
 * 使 DataKey 稳定、不必每次上传都重跑 60 万次 PBKDF2。
 * @returns {{ algorithm: string, salt: string, iterations: number, length: number }}
 */
export function generateBackupKdfParams() {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  return {
    algorithm: BACKUP_ALGORITHM,
    salt: bytesToBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    length: KEY_LENGTH
  }
}

/**
 * 从账户密码 + 配方派生 AES-GCM DataKey（不可导出的 CryptoKey）。
 * @param {string} password 云账户明文密码（仅本函数内用于派生，不留存、不上送）
 * @param {{ algorithm: string, salt: string, iterations?: number, length?: number }} kdfParams
 * @returns {Promise<CryptoKey>} AES-GCM 加解密密钥
 * @throws {Error} 配方算法不被支持时
 */
export async function deriveDataKey(password, kdfParams) {
  if (!kdfParams || kdfParams.algorithm !== BACKUP_ALGORITHM) {
    throw new Error('不支持的备份密钥派生配方')
  }
  const saltBytes = base64ToBytes(kdfParams.salt)
  const baseKey = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: kdfParams.iterations || PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: (kdfParams.length || KEY_LENGTH) * 8 },
    false, // 不可导出：密钥只在内存用于加解密，绝不外泄
    ['encrypt', 'decrypt']
  )
}

/**
 * 用 DataKey 把对象加密成后端契约的 { ciphertext, checksum }。
 *
 * 载荷布局 = IV(12B) ‖ AES-GCM 密文(含 16B Tag)，整体 base64 即 ciphertext；checksum 为该载荷
 * 字节的 SHA-256 十六进制。IV 每次随机，前置于密文，解密时切片取回（GCM 同一密钥下 IV 不复用）。
 * @param {CryptoKey} dataKey deriveDataKey 产出的 AES-GCM 密钥
 * @param {any} obj 待加密对象（整库快照）
 * @returns {Promise<{ ciphertext: string, checksum: string }>}
 */
export async function encryptJson(dataKey, obj) {
  const plaintext = new TextEncoder().encode(JSON.stringify(obj))
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const cipherBuf = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, plaintext)
  // 拼装 IV ‖ 密文+Tag
  const payload = new Uint8Array(iv.byteLength + cipherBuf.byteLength)
  payload.set(iv, 0)
  payload.set(new Uint8Array(cipherBuf), iv.byteLength)
  return {
    ciphertext: bytesToBase64(payload),
    checksum: await sha256Hex(payload)
  }
}

/**
 * 用 DataKey 解开 encryptJson 产出的 ciphertext，还原对象（供后续 GET /backup 换机恢复用）。
 * @param {CryptoKey} dataKey 与加密时同一把（同密码 + 同 kdfParams 重算）
 * @param {string} ciphertext base64 文本（IV ‖ 密文+Tag）
 * @returns {Promise<any>} 还原后的对象
 * @throws {Error} 密钥不符 / 数据损坏时 AES-GCM 验证失败抛出
 */
export async function decryptJson(dataKey, ciphertext) {
  const payload = base64ToBytes(ciphertext)
  const iv = payload.slice(0, IV_LENGTH)
  const cipher = payload.slice(IV_LENGTH)
  const plainBuf = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, dataKey, cipher)
  return JSON.parse(new TextDecoder().decode(plainBuf))
}

// --------------------------------------------------------------------------- //
// 包裹式密钥（envelope encryption）——「随机 DataKey + 多把钥匙各包裹一份」
//
// 取代「DataKey 直接由密码派生」：DataKey 改为随机生成、独立于任何口令；密码与恢复码各派生一把
// KEK（密钥包裹密钥），分别用 AES-GCM 把 DataKey 原始字节加密成一份 wrapped blob。于是：
//   - 改密：只用新密码重算 KEK 重新包裹 DataKey，整库密文与 DataKey 不变（数据零重加密）；
//   - 忘密码重置：用恢复码派生的 KEK 解开 recovery-wrapped 取回同一 DataKey，数据不失效。
// wrapped blob 布局与 encryptJson 一致：IV(12B) ‖ AES-GCM(密文+Tag)，整体 base64。
// --------------------------------------------------------------------------- //

/** Crockford Base32 字母表（去除易混淆的 I/L/O/U），用于恢复码人类可读编码。 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * 生成随机 DataKey 原始字节（32B = AES-256）。真正加密整库的密钥，独立于账户密码。
 * @returns {Uint8Array}
 */
export function generateDataKeyRaw() {
  return webcrypto.getRandomValues(new Uint8Array(KEY_LENGTH))
}

/**
 * 把 DataKey 原始字节导入为 AES-GCM CryptoKey，供 encryptJson / decryptJson 加解密整库。
 * @param {Uint8Array} rawBytes 32 字节 DataKey
 * @returns {Promise<CryptoKey>}
 */
export function importDataKey(rawBytes) {
  return webcrypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/**
 * 从口令（账户密码 / 恢复码）+ 配方派生 KEK（密钥包裹密钥，AES-GCM）。
 * 与 deriveDataKey 同款 PBKDF2 参数，区别仅在语义：产物用于 wrap/unwrap DataKey，而非直接加密整库。
 * @param {string} secret 账户密码或（归一化后的）恢复码
 * @param {{ algorithm: string, salt: string, iterations?: number, length?: number }} kdfParams
 * @returns {Promise<CryptoKey>}
 */
export function deriveKek(secret, kdfParams) {
  return deriveDataKey(secret, kdfParams)
}

/**
 * 用 KEK 包裹 DataKey 原始字节 → base64(IV ‖ 密文+Tag)。
 * @param {CryptoKey} kek deriveKek 产出的包裹密钥
 * @param {Uint8Array} dataKeyRaw DataKey 原始字节
 * @returns {Promise<string>} base64 文本（wrapped blob）
 */
export async function wrapDataKey(kek, dataKeyRaw) {
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const cipherBuf = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, dataKeyRaw)
  const payload = new Uint8Array(iv.byteLength + cipherBuf.byteLength)
  payload.set(iv, 0)
  payload.set(new Uint8Array(cipherBuf), iv.byteLength)
  return bytesToBase64(payload)
}

/**
 * 用 KEK 解开 wrapDataKey 的产物，还原 DataKey 原始字节。
 * @param {CryptoKey} kek 与包裹时同一把（同口令 + 同 kdfParams 重算）
 * @param {string} wrapped base64 文本（IV ‖ 密文+Tag）
 * @returns {Promise<Uint8Array>} DataKey 原始字节
 * @throws {Error} 口令不符 / 数据损坏时 AES-GCM 验证失败抛出
 */
export async function unwrapDataKeyRaw(kek, wrapped) {
  const payload = base64ToBytes(wrapped)
  const iv = payload.slice(0, IV_LENGTH)
  const cipher = payload.slice(IV_LENGTH)
  const plainBuf = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, cipher)
  return new Uint8Array(plainBuf)
}

/**
 * 便捷封装：用 KEK 解包并直接导入为可加解密整库的 DataKey CryptoKey。
 * @param {CryptoKey} kek 包裹密钥
 * @param {string} wrapped wrapped blob（base64）
 * @returns {Promise<CryptoKey>}
 */
export async function unwrapDataKey(kek, wrapped) {
  const raw = await unwrapDataKeyRaw(kek, wrapped)
  return importDataKey(raw)
}

/**
 * 生成人类可抄写的恢复码：160bit 高熵随机 → Crockford Base32 → 每 4 字符分组。
 * 形如 ABCD-EFGH-…（8 组共 32 字符）。仅用于派生 RecoveryKey 包裹 DataKey，**不做认证**。
 * @returns {string}
 */
export function generateRecoveryCode() {
  const bytes = webcrypto.getRandomValues(new Uint8Array(20)) // 160 bit
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += RECOVERY_ALPHABET[(value >>> bits) & 31]
    }
    value &= (1 << bits) - 1 // 截断到剩余位，防止 32 位整数溢出累积
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g).join('-')
}

/**
 * 归一化用户输入的恢复码：去分隔符 / 空格、转大写。
 * 派生 RecoveryKey 前统一形态，容忍用户漏写连字符与大小写差异（展示态带连字符，派生态去掉）。
 * @param {string} code 用户输入
 * @returns {string}
 */
export function normalizeRecoveryCode(code) {
  return (code ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}
