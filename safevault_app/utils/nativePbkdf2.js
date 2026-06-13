/**
 * PBKDF2-HMAC-SHA256 跨端调度器 —— App 端「UTS 原生加速 + noble 兜底」，H5 端走原生 WebCrypto 上游
 *
 * 背景：App 逻辑层（Android V8 / iOS JSCore）跑在独立 JS 引擎、无 WebCrypto，原本只能用纯 JS 的
 * `@noble/hashes` 算 PBKDF2。但 verifier 的 60 万次迭代在纯 JS 下需数秒，登录因此很慢（瓶颈实测在此）。
 *
 * 优化（仅 App 端，H5 不受影响）：经 **UTS 原生插件 `safevault-pbkdf2`** 调系统加密库算 PBKDF2——
 *   - Android：Kotlin 调 `javax.crypto` 的 PBKDF2WithHmacSHA256（底层 BoringSSL），快一两个数量级；
 *   - iOS：暂为占位（返回空串→回落 noble），待真机补 CommonCrypto 实现。
 * 之所以用 UTS 而非 `plus.android` 反射：实测 plus.android **无法把 char[] 传进构造函数**，而 javax.crypto
 * 的 PBKDF2 唯一入口就是收 char[] 的 PBEKeySpec，故反射路不通；UTS 编译成真正的 Kotlin，无此限制。
 *
 * 硬约束——跨端逐位互通绝不能破：
 *   原生与 noble / H5 WebCrypto 必须对「同密码 + 同盐 + 同迭代 + 同长度」算出**完全相同**的字节，
 *   否则同一账号在不同端的 verifier / 密文不通，数据直接失效。故本模块**启动时做一次原生 vs noble 的
 *   逐位自检**（含中文密码向量），一致才启用原生，任何不一致或异常一律回落 noble。最坏情况 = 退回纯 JS
 *   路径（正确但慢），绝不产出不兼容字节。
 *
 * 安全网层级：
 *   ① 平台/插件缺失（H5 / 标准基座未含插件原生码 / iOS 占位）→ 调用抛错或返回空 → 回落 noble；
 *   ② 启动自检不通过 → 本会话永久 noble；
 *   ③ 自检通过后运行期偶发异常 → 本次调用回落 noble（不影响后续）。
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2'

// 原生 PBKDF2（UTS 插件）。仅 App 端 import：H5 无此模块，且 vet 在 H5 直接返回 false。
// 标准基座不含插件原生码时，调用会抛错/返回空，被自检捕获后回落 noble——故 import 本身安全。
// #ifdef APP-PLUS
import { pbkdf2HmacSha256 as utsPbkdf2 } from '@/uni_modules/safevault-pbkdf2'
// #endif

// --------------------------------------------------------------------------- //
// 小工具：字节 ↔ base64 / hex / UTF-8 字符串
// 经桥的二进制一律走 base64 字符串，规避 JS↔UTS 的二进制数组编组。
// 依赖 installCryptoPolyfill 已注入的全局 btoa/atob/TextEncoder/TextDecoder（main.js 保证其先于本模块运行）。
// --------------------------------------------------------------------------- //

/** Uint8Array → base64 文本 */
function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** base64 文本 → Uint8Array */
function base64ToBytes(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Uint8Array → 十六进制小写（仅自检比对用） */
function bytesToHex(bytes) {
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

/** UTF-8 字节 → 字符串（把 baseKey 的密码字节还原成字符串，传给 UTS 原生派生） */
function utf8BytesToString(bytes) {
  return new TextDecoder().decode(bytes)
}

/** 字符串 → UTF-8 字节（自检构造 noble 期望值用） */
function stringToUtf8Bytes(str) {
  return new TextEncoder().encode(str)
}

// --------------------------------------------------------------------------- //
// 原生派生：经 UTS 插件（仅 app-plus 编译进，H5/小程序不含）
// --------------------------------------------------------------------------- //

/**
 * 调 UTS 原生插件算 PBKDF2。password 还原为字符串供原生 toCharArray / .utf8；盐与结果走 base64。
 * @param {Uint8Array} passwordBytes 密码 UTF-8 字节
 * @param {Uint8Array} saltBytes 盐字节
 * @param {number} iterations 迭代次数
 * @param {number} dkLen 派生输出字节数
 * @returns {Uint8Array} 派生字节（与 noble / WebCrypto 逐位一致）
 */
function nativePbkdf2(passwordBytes, saltBytes, iterations, dkLen) {
  // #ifdef APP-PLUS
  const passwordStr = utf8BytesToString(passwordBytes)
  const saltB64 = bytesToBase64(saltBytes)
  const outB64 = utsPbkdf2(passwordStr, saltB64, iterations, dkLen)
  // iOS 占位返回空串 / 插件缺失返回空 → 视为不可用，触发回落
  if (typeof outB64 !== 'string' || outB64.length === 0) throw new Error('UTS pbkdf2 返回空（占位或不可用）')
  return base64ToBytes(outB64)
  // #endif
  // #ifndef APP-PLUS
  // 非 App 端不该走到这里（调度器已拦），保底抛错以触发回落
  throw new Error('原生 PBKDF2 仅 App 端可用')
  // #endif
}

// --------------------------------------------------------------------------- //
// 启动自检：原生与 noble 逐位比对，决定本会话是否启用原生加速
// --------------------------------------------------------------------------- //

/**
 * 自检向量：刻意小迭代（PBKDF2 的逐位一致性与迭代次数无关，4096 次足以验证算法/编码一致），
 * 含一条与 scripts/crypto-parity-test.mjs 完全相同的中文密码向量，覆盖非 ASCII 的密码编码差异。
 */
const VET_VECTORS = [
  {
    password: '我的云账户密码Aa1!',
    salt: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    c: 4096,
    dkLen: 32
  },
  {
    password: 'plain-ascii-password',
    salt: new Uint8Array([200, 150, 99, 1, 255, 0, 77, 42, 16, 16, 16, 16, 32, 64, 128, 7]),
    c: 4096,
    dkLen: 32
  }
]

/** 本会话原生是否可用（null = 尚未自检；true/false = 自检结论） */
let nativeEnabled = null
/** 自检 Promise（记忆化，只跑一次） */
let vetPromise = null
/** 自检失败原因（供屏幕指示器展示，便于无 console 环境排查） */
let vetReason = ''

/** 真正的自检逻辑：能力探测 → 逐向量逐位比对。任何异常/不一致 → false。 */
async function runVet() {
  // #ifndef APP-PLUS
  return false // H5 / 小程序：上游已是原生 WebCrypto，本模块不介入
  // #endif
  // #ifdef APP-PLUS
  try {
    for (const v of VET_VECTORS) {
      const native = nativePbkdf2(stringToUtf8Bytes(v.password), v.salt, v.c, v.dkLen)
      const expect = pbkdf2(sha256, stringToUtf8Bytes(v.password), v.salt, { c: v.c, dkLen: v.dkLen })
      if (bytesToHex(native) !== bytesToHex(expect)) {
        vetReason = '原生与 noble 派生结果不一致'
        return false
      }
    }
    return true
  } catch (e) {
    vetReason = (e && e.message) || String(e)
    return false
  }
  // #endif
}

/**
 * 确保自检已完成（记忆化）。调度器与 main.js 预热都经此，保证全应用只跑一次自检。
 * @returns {Promise<boolean>} 原生是否可用
 */
export async function ensureNativeVetted() {
  if (nativeEnabled !== null) return nativeEnabled
  if (!vetPromise) vetPromise = runVet()
  nativeEnabled = await vetPromise
  return nativeEnabled
}


// --------------------------------------------------------------------------- //
// 对外调度器：cryptoPolyfill 的 deriveBits / deriveKey 统一经此算 PBKDF2
// --------------------------------------------------------------------------- //

/**
 * 跨端 PBKDF2-HMAC-SHA256：App 端优先 UTS 原生（自检通过时），否则 / 异常时回落 noble。
 *
 * @param {Uint8Array} passwordBytes 密码的 UTF-8 字节（来自 importKey('raw', TextEncoder().encode(pwd))）
 * @param {Uint8Array} saltBytes 盐字节
 * @param {number} iterations 迭代次数
 * @param {number} dkLen 派生输出字节数
 * @returns {Promise<Uint8Array>} 派生字节
 */
export async function pbkdf2Sha256(passwordBytes, saltBytes, iterations, dkLen) {
  // #ifdef APP-PLUS
  if (await ensureNativeVetted()) {
    try {
      return nativePbkdf2(passwordBytes, saltBytes, iterations, dkLen)
    } catch (e) {
      // 运行期偶发异常：仅本次回落 noble，不推翻已通过的自检结论
    }
  }
  // #endif
  return pbkdf2(sha256, passwordBytes, saltBytes, { c: iterations, dkLen })
}
