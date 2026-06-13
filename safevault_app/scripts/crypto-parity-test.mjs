/**
 * 跨端密码学一致性自测（Node 环境）
 *
 * 目的：证明 App 端纯 JS 实现（@noble/hashes + @noble/ciphers）与 H5 端 WebCrypto
 * 在「同明文 + 同口令 + 同盐 + 同 IV」下产出**逐位一致**的密文/verifier，且能交叉解密。
 * 任何不一致都会跨端数据不通，故本脚本是改造正确性的硬底座。
 *
 * 运行：node scripts/crypto-parity-test.mjs
 */
import { webcrypto } from 'node:crypto'
import { pbkdf2Async } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2'
import { hkdf } from '@noble/hashes/hkdf'
import { gcm } from '@noble/ciphers/aes'
import { x25519 } from '@noble/curves/ed25519'

const subtle = webcrypto.subtle

// 与 services/crypto.js / utils/kdf.js 完全一致的参数
const ITERATIONS = 600000
const KEY_LEN = 32
const IV_LEN = 12

function bytesToHex(bytes) {
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

let failed = 0
function assertEq(name, a, b) {
  const ok = a === b
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `\n      web   = ${a}\n      noble = ${b}`}`)
  if (!ok) failed += 1
}

// ---------------------------------------------------------------- //
// 1) PBKDF2-SHA256 派生（verifier / DataKey 底座）逐位一致
// ---------------------------------------------------------------- //
async function testPbkdf2() {
  console.log('\n[1] PBKDF2-HMAC-SHA256 派生一致性')
  const password = '我的云账户密码Aa1!'
  const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  const passBytes = new TextEncoder().encode(password)

  // WebCrypto
  const baseKey = await subtle.importKey('raw', passBytes, { name: 'PBKDF2' }, false, ['deriveBits'])
  const webBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    KEY_LEN * 8
  )
  const webHex = bytesToHex(new Uint8Array(webBits))

  // noble
  const nobleBits = await pbkdf2Async(sha256, passBytes, salt, { c: ITERATIONS, dkLen: KEY_LEN })
  const nobleHex = bytesToHex(nobleBits)

  assertEq('PBKDF2 32B 派生位串', webHex, nobleHex)
  return { webBits, nobleBits, salt }
}

// ---------------------------------------------------------------- //
// 2) AES-256-GCM 加密逐位一致 + 交叉解密
// ---------------------------------------------------------------- //
async function testGcm(keyBytes) {
  console.log('\n[2] AES-256-GCM 加密一致性 + 交叉解密')
  const plaintext = new TextEncoder().encode(JSON.stringify({ hello: '世界', items: [1, 2, 3] }))
  const iv = new Uint8Array([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32])

  // WebCrypto 加密
  const webKey = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  const webCipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, webKey, plaintext))

  // noble 加密（gcm 默认 16B tag，密文 ‖ tag 与 WebCrypto 同布局）
  const nobleCipher = gcm(keyBytes, iv).encrypt(plaintext)

  assertEq('GCM 密文+Tag 逐位', bytesToHex(webCipher), bytesToHex(nobleCipher))

  // 交叉解密：noble 密文 → WebCrypto 解
  const webDec = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, webKey, nobleCipher))
  assertEq('WebCrypto 解 noble 密文', JSON.stringify({ hello: '世界', items: [1, 2, 3] }), new TextDecoder().decode(webDec))

  // 交叉解密：WebCrypto 密文 → noble 解
  const nobleDec = gcm(keyBytes, iv).decrypt(webCipher)
  assertEq('noble 解 WebCrypto 密文', JSON.stringify({ hello: '世界', items: [1, 2, 3] }), new TextDecoder().decode(nobleDec))
}

// ---------------------------------------------------------------- //
// 3) SHA-256 摘要（checksum）一致
// ---------------------------------------------------------------- //
async function testSha256() {
  console.log('\n[3] SHA-256 摘要一致性（checksum）')
  const data = new TextEncoder().encode('payload-bytes-示例')
  const webHex = bytesToHex(new Uint8Array(await subtle.digest('SHA-256', data)))
  const nobleHex = bytesToHex(sha256(data))
  assertEq('SHA-256 hex', webHex, nobleHex)
}

// ---------------------------------------------------------------- //
// 4) 认证密码非对称封装（sealed-box）round-trip：客户端封装 → 服务端解封还原同一明文
//    构造须与 utils/seal.js（客户端）+ services/seal.py（服务端）逐字节一致：
//    X25519 ECDH → HKDF-SHA256(salt=eph_pub‖server_pub, info) → AES-256-GCM。
// ---------------------------------------------------------------- //
const HKDF_INFO = new TextEncoder().encode('safevault/auth-seal/v1')

/** 客户端封装（镜像 utils/seal.js）：返回 eph_pub ‖ iv ‖ ct+tag 字节。 */
function sealClient(plaintext, serverPub) {
  const ephPriv = webcrypto.getRandomValues(new Uint8Array(32))
  const ephPub = x25519.getPublicKey(ephPriv)
  const shared = x25519.getSharedSecret(ephPriv, serverPub)
  const salt = new Uint8Array(64)
  salt.set(ephPub, 0)
  salt.set(serverPub, 32)
  const key = hkdf(sha256, shared, salt, HKDF_INFO, 32)
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LEN))
  const ct = gcm(key, iv).encrypt(new TextEncoder().encode(plaintext))
  const payload = new Uint8Array(32 + IV_LEN + ct.length)
  payload.set(ephPub, 0)
  payload.set(iv, 32)
  payload.set(ct, 32 + IV_LEN)
  return payload
}

/** 服务端解封（镜像 services/seal.py）：用服务端私钥 + 临时公钥还原明文。 */
function unsealServer(payload, serverPriv, serverPub) {
  const ephPub = payload.slice(0, 32)
  const iv = payload.slice(32, 32 + IV_LEN)
  const ct = payload.slice(32 + IV_LEN)
  const shared = x25519.getSharedSecret(serverPriv, ephPub)
  const salt = new Uint8Array(64)
  salt.set(ephPub, 0)
  salt.set(serverPub, 32)
  const key = hkdf(sha256, shared, salt, HKDF_INFO, 32)
  return new TextDecoder().decode(gcm(key, iv).decrypt(ct))
}

async function testSeal() {
  console.log('\n[4] 认证密码非对称封装 sealed-box round-trip')
  const serverPriv = webcrypto.getRandomValues(new Uint8Array(32))
  const serverPub = x25519.getPublicKey(serverPriv)
  const password = '我的云账户密码Aa1!@#'
  const payload = sealClient(password, serverPub)
  assertEq('sealed-box 解封还原明文', password, unsealServer(payload, serverPriv, serverPub))
  // 篡改密文末字节（tag）应解密失败
  const tampered = payload.slice()
  tampered[tampered.length - 1] ^= 0xff
  let threw = false
  try {
    unsealServer(tampered, serverPriv, serverPub)
  } catch {
    threw = true
  }
  assertEq('篡改封装应解密失败', true, threw)
}

const { webBits } = await testPbkdf2()
await testGcm(new Uint8Array(webBits))
await testSha256()
await testSeal()

console.log(`\n${failed === 0 ? '✅ 全部一致：App 纯 JS 实现与 H5 WebCrypto 跨端互通' : `❌ ${failed} 项不一致`}`)
process.exit(failed === 0 ? 0 : 1)
