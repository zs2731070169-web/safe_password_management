/**
 * WebCrypto / 文本编码 / base64 / AbortController 跨端垫片（仅 App 端注入）
 *
 * 背景：阶段 1 自源工程逐字节平移过来的密码学逻辑层（services/crypto.js、utils/kdf.js）
 * 直接调用浏览器 **WebCrypto**（`crypto.subtle.*`、`crypto.getRandomValues`）、`TextEncoder/Decoder`、
 * `btoa/atob`。H5 端这些 Web API 原生可用；但 **App 端（app-plus）逻辑层跑在独立 JS 引擎
 * （Android V8 / iOS JSCore），并非 WebView**，上述 API 全部缺失，直接调用会抛 ReferenceError。
 *
 * 设计取舍——为何用「全局垫片」而非逐文件改写（与 utils/storagePolyfill.js 同源思路）：
 *   把一套「形如 WebCrypto」的对象在 App 端启动最早期挂到 globalThis，代理到纯 JS 密码学实现
 *   （@noble/hashes 的 PBKDF2-SHA256/SHA-256 + @noble/ciphers 的 AES-256-GCM）。这样**所有平移的
 *   密码学文件零改动**，既守住「逻辑层逐字节一致 / 上层零感知」的迁移原则，又抹平平台差异。
 *
 * 跨端互通保证（硬约束）：
 *   App 端实现与 H5 端 WebCrypto 在算法/参数/字节布局上**逐位一致**——
 *     · PBKDF2-HMAC-SHA256，迭代 600000，输出 32B（与 utils/kdf.js、services/crypto.js 同档）；
 *     · AES-256-GCM，IV 12B，Tag 16B 后置于密文（noble gcm 默认布局即 ciphertext‖tag，与 WebCrypto 同）；
 *     · SHA-256 摘要、base64 编码（btoa/atob 等价）一致。
 *   故同一账号在 H5 加密的备份 App 能解、反之亦然。一致性由 scripts/crypto-parity-test.mjs 验证。
 *
 * 仅覆盖源工程实际用到的 WebCrypto 子集：
 *   crypto.getRandomValues / crypto.subtle.{importKey, deriveKey, deriveBits, digest, encrypt, decrypt}
 *   且 importKey 仅支持 'raw' 导入、PBKDF2 与 AES-GCM 两种算法（源工程全部用例）。
 */

// 纯 JS 密码学实现（零依赖、经审计、与 WebCrypto 逐位互通）
import { sha256 } from '@noble/hashes/sha2'
import { gcm } from '@noble/ciphers/aes'
// PBKDF2 跨端调度器：App 端优先系统原生加速（自检通过时），否则回落 noble；H5 不经此（走原生 WebCrypto）。
// 单独抽出是因为 PBKDF2 的 60 万次迭代是登录瓶颈，原生实现可快一两个数量级（详见 nativePbkdf2.js）。
import { pbkdf2Sha256 } from '@/utils/nativePbkdf2'

// --------------------------------------------------------------------------- //
// 轻量 CryptoKey 替身：携带原始密钥字节与用途，subtle 各方法据此分流。
// 仅 App 端内部使用，不外泄；与 WebCrypto 的「不可导出 CryptoKey」语义对齐（外界拿不到 rawBytes）。
// --------------------------------------------------------------------------- //
class PolyCryptoKey {
  constructor(rawBytes, algorithm) {
    this._raw = rawBytes // 原始密钥字节（PBKDF2 为密码字节，AES-GCM 为 32B 密钥）
    this._algorithm = algorithm // 'PBKDF2' | 'AES-GCM'
  }
}

/** 把入参规整为 Uint8Array（兼容 ArrayBuffer / TypedArray / DataView） */
function toBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  throw new TypeError('期望 ArrayBuffer/TypedArray')
}

/** 把 Uint8Array 转成全新的 ArrayBuffer（WebCrypto 各异步方法返回 ArrayBuffer，调用方常 new Uint8Array(buf)） */
function toArrayBuffer(bytes) {
  // 复制一份独立 buffer，避免 noble 内部缓冲被外部持有/复用导致的隐患
  return bytes.slice().buffer
}

// --------------------------------------------------------------------------- //
// crypto.subtle 子集实现
// --------------------------------------------------------------------------- //
const subtlePolyfill = {
  /**
   * 仅支持 format==='raw'。PBKDF2：keyData 为密码字节；AES-GCM：keyData 为 32B 原始密钥。
   * 返回 PolyCryptoKey 替身（异步对齐 WebCrypto 签名）。
   */
  async importKey(format, keyData, algorithm) {
    if (format !== 'raw') throw new Error(`cryptoPolyfill: 仅支持 raw 导入，收到 ${format}`)
    const name = typeof algorithm === 'string' ? algorithm : algorithm?.name
    return new PolyCryptoKey(toBytes(keyData), name)
  },

  /**
   * PBKDF2 deriveBits：返回派生位串的 ArrayBuffer（length 单位为 bit，对齐 WebCrypto）。
   * 用于 utils/kdf.js 的 verifier 派生。
   */
  async deriveBits(algorithm, baseKey, length) {
    if (algorithm?.name !== 'PBKDF2') throw new Error('cryptoPolyfill: deriveBits 仅支持 PBKDF2')
    if (algorithm.hash !== 'SHA-256') throw new Error('cryptoPolyfill: 仅支持 SHA-256')
    const dkLen = length / 8 // bit → byte
    // 经调度器算 PBKDF2：App 端走系统原生加速 / noble 兜底，逐位与 H5 WebCrypto 一致
    const derived = await pbkdf2Sha256(baseKey._raw, toBytes(algorithm.salt), algorithm.iterations, dkLen)
    return toArrayBuffer(derived)
  },

  /**
   * PBKDF2 deriveKey：派生出 AES-GCM 用的 PolyCryptoKey。
   * derivedKeyType.length 单位为 bit（如 256），换算字节后做 PBKDF2，再包成 AES-GCM 密钥。
   * 用于 services/crypto.js 的 DataKey / KEK 派生。
   */
  async deriveKey(algorithm, baseKey, derivedKeyType) {
    if (algorithm?.name !== 'PBKDF2') throw new Error('cryptoPolyfill: deriveKey 仅支持 PBKDF2')
    if (algorithm.hash !== 'SHA-256') throw new Error('cryptoPolyfill: 仅支持 SHA-256')
    if (derivedKeyType?.name !== 'AES-GCM') throw new Error('cryptoPolyfill: deriveKey 目标仅支持 AES-GCM')
    const dkLen = (derivedKeyType.length || 256) / 8
    // 经调度器算 PBKDF2：App 端走系统原生加速 / noble 兜底，逐位与 H5 WebCrypto 一致
    const keyBytes = await pbkdf2Sha256(baseKey._raw, toBytes(algorithm.salt), algorithm.iterations, dkLen)
    return new PolyCryptoKey(keyBytes, 'AES-GCM')
  },

  /** SHA-256 摘要：返回 ArrayBuffer（用于 checksum）。 */
  async digest(algorithm, data) {
    const name = typeof algorithm === 'string' ? algorithm : algorithm?.name
    if (name !== 'SHA-256') throw new Error(`cryptoPolyfill: digest 仅支持 SHA-256，收到 ${name}`)
    return toArrayBuffer(sha256(toBytes(data)))
  },

  /**
   * AES-256-GCM 加密：返回 ArrayBuffer（密文 ‖ 16B Tag，与 WebCrypto 同布局）。
   * @param {{ name:'AES-GCM', iv:Uint8Array }} algorithm
   */
  async encrypt(algorithm, key, data) {
    if (algorithm?.name !== 'AES-GCM') throw new Error('cryptoPolyfill: encrypt 仅支持 AES-GCM')
    const cipher = gcm(key._raw, toBytes(algorithm.iv)).encrypt(toBytes(data))
    return toArrayBuffer(cipher)
  },

  /**
   * AES-256-GCM 解密：返回明文 ArrayBuffer；Tag 校验失败（密钥不符/数据损坏）时 noble 抛错，
   * 与 WebCrypto decrypt 失败抛异常的语义一致（上层据此识别口令错误 / 损坏）。
   */
  async decrypt(algorithm, key, data) {
    if (algorithm?.name !== 'AES-GCM') throw new Error('cryptoPolyfill: decrypt 仅支持 AES-GCM')
    const plain = gcm(key._raw, toBytes(algorithm.iv)).decrypt(toBytes(data))
    return toArrayBuffer(plain)
  }
}

// --------------------------------------------------------------------------- //
// 纯 JS CSPRNG 随机源：getRandomValues
// 优先 uni 的安全随机（若基座提供），否则用经审计的 noble 内部随机（@noble 依赖的平台随机），
// 最终兜底 Math.random（仅极端缺失时，保证不崩溃；正常 App 基座不会走到）。
// --------------------------------------------------------------------------- //
function fillRandom(typedArray) {
  const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)
  // uni-app App 端部分基座暴露 plus.* 但无标准 CSPRNG；这里优先尝试运行环境可能已有的 crypto 原生随机，
  // 若整个 crypto 都缺失（本垫片正是为此而生），回落到 Math.random 逐字节填充。
  // 说明：@noble 的对称原语自身不依赖此函数；本函数仅服务源工程显式的 crypto.getRandomValues 调用
  // （IV / salt / DataKey / 恢复码）。这些场景对随机质量敏感，故优先走更强来源。
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return typedArray
}

// --------------------------------------------------------------------------- //
// 纯 JS base64：btoa / atob（App 端无浏览器全局）
// --------------------------------------------------------------------------- //
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function polyBtoa(binary) {
  let out = ''
  let i = 0
  const len = binary.length
  while (i < len) {
    const c1 = binary.charCodeAt(i++) & 0xff
    const c2 = i < len ? binary.charCodeAt(i++) & 0xff : NaN
    const c3 = i < len ? binary.charCodeAt(i++) & 0xff : NaN
    const e1 = c1 >> 2
    const e2 = ((c1 & 3) << 4) | (c2 >> 4)
    let e3 = ((c2 & 15) << 2) | (c3 >> 6)
    let e4 = c3 & 63
    if (Number.isNaN(c2)) {
      e3 = 64
      e4 = 64
    } else if (Number.isNaN(c3)) {
      e4 = 64
    }
    out += B64_CHARS.charAt(e1) + B64_CHARS.charAt(e2) + (e3 === 64 ? '=' : B64_CHARS.charAt(e3)) + (e4 === 64 ? '=' : B64_CHARS.charAt(e4))
  }
  return out
}

function polyAtob(b64) {
  const clean = String(b64).replace(/[^A-Za-z0-9+/=]/g, '')
  let out = ''
  let i = 0
  const len = clean.length
  while (i < len) {
    const d1 = B64_CHARS.indexOf(clean.charAt(i++))
    const d2 = B64_CHARS.indexOf(clean.charAt(i++))
    const d3 = B64_CHARS.indexOf(clean.charAt(i++))
    const d4 = B64_CHARS.indexOf(clean.charAt(i++))
    const c1 = (d1 << 2) | (d2 >> 4)
    const c2 = ((d2 & 15) << 4) | (d3 >> 2)
    const c3 = ((d3 & 3) << 6) | d4
    out += String.fromCharCode(c1)
    if (d3 !== 64 && d3 !== -1) out += String.fromCharCode(c2)
    if (d4 !== 64 && d4 !== -1) out += String.fromCharCode(c3)
  }
  return out
}

// --------------------------------------------------------------------------- //
// 纯 JS TextEncoder / TextDecoder（仅 UTF-8，源工程唯一用法）
// --------------------------------------------------------------------------- //
class PolyTextEncoder {
  /** UTF-8 编码：字符串 → Uint8Array */
  encode(str) {
    const s = String(str)
    const bytes = []
    for (let i = 0; i < s.length; i += 1) {
      let code = s.charCodeAt(i)
      // 处理代理对（emoji 等 BMP 外字符）
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
        const next = s.charCodeAt(i + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
          i += 1
        }
      }
      if (code < 0x80) {
        bytes.push(code)
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      } else {
        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      }
    }
    return new Uint8Array(bytes)
  }
}

class PolyTextDecoder {
  /** UTF-8 解码：ArrayBuffer/TypedArray → 字符串 */
  decode(input) {
    if (input == null) return ''
    const bytes = toBytes(input)
    let out = ''
    let i = 0
    const len = bytes.length
    while (i < len) {
      const b1 = bytes[i++]
      if (b1 < 0x80) {
        out += String.fromCharCode(b1)
      } else if (b1 >= 0xc0 && b1 < 0xe0) {
        const b2 = bytes[i++]
        out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
      } else if (b1 >= 0xe0 && b1 < 0xf0) {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        out += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      } else {
        const b2 = bytes[i++]
        const b3 = bytes[i++]
        const b4 = bytes[i++]
        let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
        cp -= 0x10000
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      }
    }
    return out
  }
}

// --------------------------------------------------------------------------- //
// 显式 crypto 句柄（逻辑层的主路径，务必优先于「裸全局 crypto」使用）
//
// 为何不能只靠下面 installCryptoPolyfill 的「全局覆盖」：实测部分 App 真机基座（Android V8 / iOS
// JSCore）会**预先占用一个 `crypto` 全局**，且按 WebCrypto 规范它是 non-configurable / non-writable，
// 其对象往往还 non-extensible。这种属性**在 JS 语言层面无法被任何手段覆盖**——`g.crypto = x` 静默失败、
// `Object.defineProperty` 抛错、`g.crypto.subtle = x` 在不可扩展对象上又静默失败。结果裸写的
// `crypto.subtle.importKey` 取到基座那个**残缺/缺失**的 subtle（典型现象：真机点登录报「无法读取未定义的
// importKey」）。TextEncoder / btoa / atob 没这问题，是因为基座不占这些名字，全局新建即可生效。
//
// 故密码学逻辑文件（services/crypto.js、utils/kdf.js、stores/generator.js）一律 import 本句柄并用
// `webcrypto.subtle` / `webcrypto.getRandomValues`，不再依赖裸全局。App 端指向 noble 垫片，H5 端指向
// 原生 WebCrypto——两端算法/参数/字节布局逐位一致，跨端互通不变。
// --------------------------------------------------------------------------- //

/** App 端随机源：优先基座原生 CSPRNG（质量更可靠），缺失时回落 noble/Math 兜底。 */
function appGetRandomValues(typedArray) {
  const host = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  const fn = host && host.getRandomValues
  if (typeof fn === 'function' && fn !== fillRandom) {
    try {
      return fn.call(host, typedArray)
    } catch (_) {
      /* 基座随机不可用，回落 */
    }
  }
  return fillRandom(typedArray)
}

/** 解析出当前平台可靠的 crypto 句柄（条件编译按端各保留一支）。 */
function resolveWebCrypto() {
  // #ifdef APP-PLUS
  return {
    subtle: subtlePolyfill,
    getRandomValues: appGetRandomValues
  }
  // #endif
  // #ifndef APP-PLUS
  // H5 端原生 WebCrypto；保留对 crypto 的方法绑定（subtle/getRandomValues 内部依赖正确 this）
  return (typeof globalThis !== 'undefined' && globalThis.crypto) || crypto
  // #endif
}

/**
 * 跨端 crypto 句柄：逻辑层应 import 它而非裸写全局 `crypto`。
 * App = noble 垫片；H5 = 原生 WebCrypto。
 */
export const webcrypto = resolveWebCrypto()

/**
 * 在 App 端把 WebCrypto / 文本编码 / base64 / AbortController 垫片挂到 globalThis（H5 端为 no-op）。
 * 须在 createApp / 任何 store/service 初始化「之前」调用（见 main.js），且建议在 storagePolyfill 之后。
 *
 * 注意：本函数是「尽力而为」的全局覆盖，主要为 TextEncoder / TextDecoder / btoa / atob / AbortController
 * 兜底（这些基座通常缺失，全局新建即生效）。**密码学必须走上面的 `webcrypto` 句柄**，因为基座预置的
 * `crypto` 全局可能无法覆盖（见上方说明）。
 */
export function installCryptoPolyfill() {
  // #ifdef APP-PLUS
  const g = globalThis

  // crypto（含 subtle 与 getRandomValues）
  //
  // 注意：这里**不能**沿用「基座已有 subtle 就让位」的策略。部分 App 基座（实测 Android 真机基座）
  // 会暴露一个**残缺 / 受限的 crypto.subtle**：对象在、但 importKey/deriveBits 等在该运行环境不可用，
  // 一调用即抛错（典型表现：HBuilderX 真机调试点登录报 importKey 相关错误）。若因「subtle 存在」而跳过
  // 注入，就会落到这个坏实现上。
  //
  // 且「跨端逐位互通」是硬约束：H5 与 App 必须算出完全相同的 verifier / 密文，基座 WebCrypto 即便能跑，
  // 其可用性与字节布局也无保证。故 **App 端一律用 noble 垫片覆盖 subtle**，只有 getRandomValues 在
  // 基座提供原生 CSPRNG 时优先采用（随机源基座实现通常更可靠）。
  {
    const existing = g.crypto && typeof g.crypto === 'object' ? g.crypto : {}
    const polyCrypto = {
      ...existing,
      getRandomValues:
        existing.getRandomValues && typeof existing.getRandomValues === 'function'
          ? existing.getRandomValues.bind(existing)
          : fillRandom,
      subtle: subtlePolyfill
    }
    // 健壮赋值：个别基座的 globalThis.crypto 为只读属性，直接整体替换会静默失败（非严格模式）
    // 或抛错（严格模式），导致垫片未生效仍走基座坏实现。逐级退化以确保最终一定挂上垫片。
    try {
      g.crypto = polyCrypto
    } catch (_) {
      /* 只读，下面再试 */
    }
    if (g.crypto !== polyCrypto) {
      try {
        Object.defineProperty(g, 'crypto', { value: polyCrypto, configurable: true, writable: true })
      } catch (_) {
        // crypto 整体不可替换：退而把垫片 subtle / 随机源挂到现有 crypto 对象上
        try {
          g.crypto.subtle = subtlePolyfill
        } catch (_) {
          /* 实在挂不上只能依赖基座，已尽力 */
        }
        if (!g.crypto.getRandomValues) {
          try {
            g.crypto.getRandomValues = fillRandom
          } catch (_) {
            /* 同上 */
          }
        }
      }
    }
  }

  // 文本编码
  if (typeof g.TextEncoder === 'undefined') g.TextEncoder = PolyTextEncoder
  if (typeof g.TextDecoder === 'undefined') g.TextDecoder = PolyTextDecoder

  // base64
  if (typeof g.btoa === 'undefined') g.btoa = polyBtoa
  if (typeof g.atob === 'undefined') g.atob = polyAtob

  // AbortController：现代 V8/JSCore 多已内置；缺失时补最小实现（http.js 取消语义依赖它）
  if (typeof g.AbortController === 'undefined') {
    g.AbortController = class {
      constructor() {
        const listeners = []
        this.signal = {
          aborted: false,
          addEventListener(type, cb) {
            if (type === 'abort') listeners.push(cb)
          },
          removeEventListener(type, cb) {
            if (type !== 'abort') return
            const idx = listeners.indexOf(cb)
            if (idx >= 0) listeners.splice(idx, 1)
          },
          _listeners: listeners
        }
      }

      abort() {
        if (this.signal.aborted) return
        this.signal.aborted = true
        this.signal._listeners.slice().forEach((cb) => {
          try {
            cb({ type: 'abort' })
          } catch (_) {
            /* 单个监听异常不影响其余 */
          }
        })
      }
    }
  }
  // #endif
  // #ifndef APP-PLUS
  // H5 端原生 WebCrypto / TextEncoder / btoa / AbortController 即可，无需任何处理
  // #endif
}
