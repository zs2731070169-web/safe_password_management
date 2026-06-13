/**
 * 服务端密码封装公钥的获取与缓存 —— 隔离 GET /auth/seal-pubkey 调用
 *
 * 登录提速方案下，客户端在注册 / 登录 / 改密 / 重置前需先拿到服务端 X25519 公钥，用它把明文密码
 * 非对称封装（见 utils/seal.js）后上送。公钥公开不损安全（私钥永不出端），可放心缓存。
 *
 * 缓存策略：**仅会话内存缓存**（不落 localStorage）。理由：公钥若被持久化而服务端轮换了密钥对，
 * 旧公钥封装的密码后端解不开（统一 400「密码封装无效」），会造成「重装/清缓存才能登录」的死状态；
 * 内存缓存则每次启动重新拉一次（一个极轻量 GET），既省往返又无陈旧风险。dev 默认公钥固定，
 * 生产轮换后客户端下次启动自动取新公钥。若一次封装上送遭遇 400，可调用 clearSealKeyCache 后重试。
 */

import { getJson } from '@/services/http'

/** 会话内存缓存的服务端公钥（base64），null 表示尚未拉取。 */
let _cachedPubKey = null
/** 在途拉取的 Promise，合并并发请求，避免首屏多处同时触发重复 GET。 */
let _inflight = null

/**
 * 取服务端密码封装公钥（base64）。命中内存缓存直接返回；否则拉一次并缓存。
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @returns {Promise<string>} 服务端 X25519 公钥（32 字节原始公钥的 base64）
 * @throws {Error} 后端未返回公钥 / 网络异常（由 http 层抛出，含中文 message）
 */
export async function getServerSealPubKey({ signal } = {}) {
  if (_cachedPubKey) return _cachedPubKey
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      const res = await getJson('/auth/seal-pubkey', { signal })
      const pub = res?.public_key
      if (!pub) throw new Error('无法获取服务端公钥，请稍后重试')
      _cachedPubKey = pub
      return pub
    } finally {
      _inflight = null
    }
  })()
  return _inflight
}

/** 清空公钥缓存（公钥疑似过期、封装上送遭遇 400 时调用，下次按需重新拉取）。 */
export function clearSealKeyCache() {
  _cachedPubKey = null
}
