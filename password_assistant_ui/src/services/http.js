/**
 * 轻量 HTTP 客户端 —— 隔离对后端 REST 接口的调用细节
 *
 * 用原生 fetch 封装，统一处理：基地址拼接、JSON 序列化、AbortSignal 取消、
 * 以及把后端错误体里的 `detail` 抽成可直接展示的中文 Error.message。
 *
 * 基地址来源（按优先级）：
 *   - 构建期注入的 VITE_API_BASE_URL（生产 / Capacitor APK 直连后端，如 https://api.example.com）；
 *   - 缺省为空串，走同源相对路径 —— 开发期由 Vite proxy 把 /auth/* 转发到本地后端（见 vite.config.js）。
 *
 * 与 services/ 下其它封装（biometric / clipboard）一致：视图与 store 不直接碰 fetch，
 * 只调用这里的语义化方法；后端联调细节变化时只动本文件。
 */

/** 后端基地址：生产经环境变量注入，开发留空走 Vite proxy */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

/**
 * 从后端错误响应里提取一句可展示的中文提示。
 * 兼容两种 detail 形态：
 *   - 业务异常：{ detail: "请稍后再试" }（字符串，CooldownError / RateLimitError）
 *   - 校验失败：{ detail: [{ loc, msg, ... }] }（FastAPI 422，msg 为英文）
 * @param {any} body 已解析的响应体（可能为 null）
 * @param {number} status HTTP 状态码
 * @returns {string}
 */
function extractMessage(body, status) {
  const detail = body?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    // 422 校验错误：优先给出首条 msg，无则回落通用文案
    const first = detail[0]
    if (first?.msg) return String(first.msg)
  }
  // 兜底：按状态码给中文默认提示
  if (status === 429) return '操作过于频繁，请稍后再试'
  if (status >= 500) return '服务器繁忙，请稍后再试'
  return '请求失败，请重试'
}

/**
 * 发送 JSON POST 请求。
 * @param {string} path 接口路径（以 / 开头，如 /auth/verify-code）
 * @param {object} body 请求体，自动 JSON 序列化
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @returns {Promise<any>} 成功时解析后的响应体
 * @throws {Error} 非 2xx 时抛出，message 为后端 detail；附带 status 字段。
 *                 取消时抛出 name === 'AbortError' 的异常（由 fetch 透传）。
 */
export async function postJson(path, body, { signal } = {}) {
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    // 取消异常原样透传，交由上层识别 AbortError 静默处理
    if (err?.name === 'AbortError') throw err
    // 网络层失败（断网 / 后端未启动 / 跨域被拦）
    throw new Error('网络异常，请检查连接后重试')
  }

  // 解析响应体：成功与失败都可能带 JSON；解析失败按空体处理
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    const error = new Error(extractMessage(data, res.status))
    error.status = res.status
    throw error
  }
  return data
}
