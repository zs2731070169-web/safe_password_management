/**
 * 跨端备份链路端到端互通自测（Node 环境）
 *
 * 目标：证明「同账号在 H5 端加密的整库备份，App 端能解开；反之亦然」——即 services/crypto.js 的
 * 整条 deriveDataKey → encryptJson → decryptJson 链路在两端逐位互通。
 *
 * 为何不直接 import services/crypto.js：自 importKey 修复起，crypto.js 改为 import 跨端句柄
 * `webcrypto`（App = noble 垫片 / H5 = 原生 WebCrypto），该句柄在**模块加载时一次性解析**，无法再用
 * 「运行时替换 globalThis.crypto」来模拟两端。故本脚本在此**复刻 crypto.js 的备份编解码框架**
 * （IV(12B) ‖ 密文+Tag、base64、SHA-256 checksum），分别注入「H5 原语（Node 原生 WebCrypto）」与
 * 「App 原语（cryptoPolyfill 的 noble subtle）」跑同一套框架并交叉解密。
 *
 * 框架须与 services/crypto.js 保持一致；底层原语（PBKDF2 / AES-GCM / SHA-256）的跨端**逐位一致**
 * 由 scripts/crypto-parity-test.mjs 单独保证，二者合起来即等价于「真实 crypto.js 跨端互解」。
 *
 * 运行：node scripts/crypto-e2e-test.mjs
 */
import { webcrypto as nodeWebcrypto } from 'node:crypto'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2'
import { gcm } from '@noble/ciphers/aes'

// ---- App 端纯 JS subtle（与 utils/cryptoPolyfill.js 的 subtlePolyfill 等价）---- //
function toBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  throw new TypeError('bytes')
}
function toAB(b) {
  return b.slice().buffer
}
class PolyKey {
  constructor(raw) {
    this._raw = raw
  }
}
const appSubtle = {
  async importKey(_f, keyData) {
    return new PolyKey(toBytes(keyData))
  },
  async deriveKey(alg, base, type) {
    const k = pbkdf2(sha256, base._raw, toBytes(alg.salt), { c: alg.iterations, dkLen: (type.length || 256) / 8 })
    return new PolyKey(k)
  },
  async digest(_a, data) {
    return toAB(sha256(toBytes(data)))
  },
  async encrypt(alg, key, data) {
    return toAB(gcm(key._raw, toBytes(alg.iv)).encrypt(toBytes(data)))
  },
  async decrypt(alg, key, data) {
    return toAB(gcm(key._raw, toBytes(alg.iv)).decrypt(toBytes(data)))
  }
}

// App 端 getRandomValues（测试用 Math.random 填充即可；随机源不影响互解验证）
function appRandom(arr) {
  const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(Math.random() * 256)
  return arr
}

// 两端 crypto 句柄：与生产环境一一对应
const H5 = { subtle: nodeWebcrypto.subtle, getRandomValues: (a) => nodeWebcrypto.getRandomValues(a), label: 'H5(WebCrypto)' }
const APP = { subtle: appSubtle, getRandomValues: appRandom, label: 'App(垫片)' }

// --------------------------------------------------------------------------- //
// 复刻 services/crypto.js 的备份编解码框架（保持与之一致）
// --------------------------------------------------------------------------- //
const BACKUP_ALGORITHM = 'AES-GCM-PBKDF2-SHA256'
const PBKDF2_ITERATIONS = 600000
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 12

function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
function bytesToHex(bytes) {
  let hex = ''
  for (let i = 0; i < bytes.byteLength; i += 1) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}
async function sha256Hex(bytes, c) {
  return bytesToHex(new Uint8Array(await c.subtle.digest('SHA-256', bytes)))
}

/** 生成一份固定可复用的派生配方（随机 salt） */
function makeKdfParams(c) {
  const salt = c.getRandomValues(new Uint8Array(SALT_LENGTH))
  return { algorithm: BACKUP_ALGORITHM, salt: bytesToBase64(salt), iterations: PBKDF2_ITERATIONS, length: KEY_LENGTH }
}

/** 账户密码 + 配方 → AES-GCM DataKey（每端用各自原语派生，PBKDF2 结果逐位一致） */
async function deriveDataKey(password, kdfParams, c) {
  const saltBytes = base64ToBytes(kdfParams.salt)
  const baseKey = await c.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey'])
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: kdfParams.iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: kdfParams.length * 8 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** 加密：IV(12B) ‖ 密文+Tag → base64 + SHA-256 checksum */
async function encryptJson(dataKey, obj, c) {
  const plaintext = new TextEncoder().encode(JSON.stringify(obj))
  const iv = c.getRandomValues(new Uint8Array(IV_LENGTH))
  const cipherBuf = await c.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, plaintext)
  const payload = new Uint8Array(iv.byteLength + cipherBuf.byteLength)
  payload.set(iv, 0)
  payload.set(new Uint8Array(cipherBuf), iv.byteLength)
  return { ciphertext: bytesToBase64(payload), checksum: await sha256Hex(payload, c) }
}

/** 解密：切回 IV / 密文，AES-GCM 还原对象 */
async function decryptJson(dataKey, ciphertext, c) {
  const payload = base64ToBytes(ciphertext)
  const iv = payload.slice(0, IV_LENGTH)
  const cipher = payload.slice(IV_LENGTH)
  const plainBuf = await c.subtle.decrypt({ name: 'AES-GCM', iv }, dataKey, cipher)
  return JSON.parse(new TextDecoder().decode(plainBuf))
}

let failed = 0
function check(name, ok) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`)
  if (!ok) failed += 1
}

// 同账号共用一份配方（同一 salt → 两端派生同一 DataKey）
const kdfParams = makeKdfParams(H5)
const password = '账户口令Test@2026'
const vaultSnapshot = { entries: [{ id: 1, name: 'GitHub', pwd: '●secret●' }], 版本: 7 }

async function encryptIn(env) {
  const key = await deriveDataKey(password, kdfParams, env)
  return encryptJson(key, vaultSnapshot, env)
}
async function decryptIn(env, ciphertext) {
  const key = await deriveDataKey(password, kdfParams, env)
  return decryptJson(key, ciphertext, env)
}

console.log('\n[E2E] 整库备份编解码框架跨端互解（H5 原语 ↔ App 原语）')

// H5 加密 → App 解密
const h5Cipher = await encryptIn(H5)
const appDecoded = await decryptIn(APP, h5Cipher.ciphertext)
check('H5 加密的备份 → App 解密还原一致', JSON.stringify(appDecoded) === JSON.stringify(vaultSnapshot))

// App 加密 → H5 解密
const appCipher = await encryptIn(APP)
const h5Decoded = await decryptIn(H5, appCipher.ciphertext)
check('App 加密的备份 → H5 解密还原一致', JSON.stringify(h5Decoded) === JSON.stringify(vaultSnapshot))

console.log(`\n${failed === 0 ? '✅ 整库备份链路跨端互通：同账号 H5/App 加密的备份可互相解密' : `❌ ${failed} 项失败`}`)
process.exit(failed === 0 ? 0 : 1)
