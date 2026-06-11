/**
 * 客户端密钥派生（零知识）—— 用 WebCrypto PBKDF2-SHA256 从云账户密码派生「密码验证器」
 *
 * 时序图 §2 约束：注册请求体携带的是 verifier + kdf_params，而非明文密码。
 * 明文密码**绝不出端**——本工具在浏览器/设备本地把密码派生成一段不可逆的验证器（verifier），
 * 后端只拿到 verifier 与派生配方（kdf_params），无法还原密码或 MasterKey。
 *
 * 设计说明：
 *   - 算法 PBKDF2-HMAC-SHA256，迭代 600000（兼顾移动端可接受耗时与抗离线爆破）。
 *   - 每次派生用随机 16 字节 client salt，连同算法参数写入 kdf_params 一并上送，
 *     后端透传存库；换机后据 kdf_params 用同一密码可重算出同一 MasterKey（本模块只产 verifier，
 *     MasterKey/DataKey 包裹属模块 2，后续接入）。
 *   - verifier 取派生输出 32 字节，base64 文本编码，匹配后端 password_verifier 列与 16~1024 长度校验。
 *
 * 仅依赖标准 WebCrypto（window.crypto.subtle），无第三方库。Capacitor WebView 与现代浏览器均支持。
 */

/** 派生算法标识，写入 kdf_params，后端与换机端据此识别配方 */
const KDF_ALGORITHM = 'PBKDF2-SHA256'
/** PBKDF2 迭代次数：越大越抗爆破，移动端 60 万次约百毫秒级 */
const KDF_ITERATIONS = 600000
/** 派生输出长度（字节），32 字节 = 256 位 */
const KDF_KEY_LENGTH = 32
/** client salt 长度（字节） */
const SALT_LENGTH = 16

/**
 * ArrayBuffer / TypedArray → base64 文本（用于 verifier、salt 的可传输编码）。
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string} base64 字符串
 */
function bufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * base64 文本 → Uint8Array（用于从 kdf_params 还原 client salt）。
 * @param {string} b64 base64 字符串
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * PBKDF2-SHA256 派生核心：给定密码与盐 / 迭代 / 长度，算出 verifier 的 base64。
 *
 * 注册（deriveVerifier，随机盐）与登录（deriveVerifierWithParams，注册时存下的盐）共用此核心，
 * 保证「同密码 + 同 kdf_params」必然派生出**完全相同**的 verifier——这是登录能比中后端
 * password_verifier 的前提。
 *
 * @param {string} password 明文密码（仅在本函数内用于派生，不留存、不上送）
 * @param {Uint8Array} saltBytes client salt 原始字节
 * @param {number} iterations PBKDF2 迭代次数
 * @param {number} lengthBytes 派生输出字节数
 * @returns {Promise<string>} base64 编码的 verifier
 */
async function deriveVerifierBits(password, saltBytes, iterations, lengthBytes) {
  // 把密码导入为 PBKDF2 原始密钥材料（不可导出）
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  // PBKDF2 派生指定位长的验证器位串
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    lengthBytes * 8 // 以 bit 为单位
  )
  return bufferToBase64(derivedBits)
}

/**
 * 从云账户密码派生密码验证器与派生配方（零知识，明文密码不出端）。
 *
 * @param {string} password 用户输入的云账户明文密码（仅在本函数内用于派生，不留存、不上送）
 * @returns {Promise<{ verifier: string, kdfParams: { algorithm: string, salt: string, iterations: number, length: number } }>}
 *   verifier：base64 编码的密码验证器；kdfParams：派生配方（随请求上送，后端透传存库）。
 */
export async function deriveVerifier(password) {
  // 1) 随机 client salt（每个账户独立，防彩虹表）
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))

  // 2) 用共享核心派生 32 字节验证器
  const verifier = await deriveVerifierBits(password, salt, KDF_ITERATIONS, KDF_KEY_LENGTH)

  return {
    verifier,
    kdfParams: {
      algorithm: KDF_ALGORITHM,
      salt: bufferToBase64(salt),
      iterations: KDF_ITERATIONS,
      length: KDF_KEY_LENGTH
    }
  }
}

/**
 * 登录用：按注册时存下的 kdf_params（含 client salt / 迭代 / 长度）重算出**同一个** verifier。
 *
 * 时序图 §3 登录请求体只带 `{ email, verifier }`，后端用该账户已存的 server_salt 对此 verifier
 * 再次慢哈希后与库里 password_verifier 比对。故客户端必须用注册时同一份 kdf_params 重算 verifier，
 * 才能比中。kdf_params 在注册成功后随账户一并持久化在本端（非机密：仅盐 + 迭代参数）。
 *
 * @param {string} password 用户输入的云账户明文密码（仅用于本地派生，不留存、不上送）
 * @param {{ algorithm: string, salt: string, iterations: number, length: number }} kdfParams
 *   注册时产生并存下的派生配方
 * @returns {Promise<string>} base64 编码的 verifier（与注册时一致）
 * @throws {Error} 配方算法不被支持时
 */
export async function deriveVerifierWithParams(password, kdfParams) {
  if (!kdfParams || kdfParams.algorithm !== KDF_ALGORITHM) {
    throw new Error('不支持的密钥派生配方')
  }
  const saltBytes = base64ToBytes(kdfParams.salt)
  const iterations = kdfParams.iterations || KDF_ITERATIONS
  const length = kdfParams.length || KDF_KEY_LENGTH
  return deriveVerifierBits(password, saltBytes, iterations, length)
}
