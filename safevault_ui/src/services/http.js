/**
 * 轻量 HTTP 客户端 —— 隔离对后端 REST 接口的调用细节
 *
 * 用原生 fetch 封装，统一处理：基地址拼接、JSON 序列化、AbortSignal 取消、
 * 以及把后端错误体里的 `detail` 抽成可直接展示的中文 Error.message。
 *
 * 后端统一挂在 `/safevault` 根下（认证 /safevault/auth/*、加密备份 /safevault/backup*）。
 * 各调用方仍传相对接口路径（如 /auth/verify-code、/backup），本文件统一拼上这一根前缀，
 * 故 dev 与生产环境的「单一根地址」保持一致，调用方无需感知。
 *
 * 基地址来源（按优先级）：
 *   - 构建期注入的 VITE_API_BASE_URL（生产 / Capacitor APK 直连后端，如 https://api.example.com）；
 *   - 缺省为空串，走同源相对路径 —— 开发期由 Vite proxy 把 /safevault/* 转发到本地后端（见 vite.config.js）。
 * 无论何种来源，最终都会再拼上 API_ROOT(/safevault) 作为统一根。
 *
 * 与 services/ 下其它封装（biometric / clipboard）一致：视图与 store 不直接碰 fetch，
 * 只调用这里的语义化方法；后端联调细节变化时只动本文件。
 */

/** 后端统一根地址段：所有接口路径都挂在它下面，dev 走 Vite proxy、生产随基地址直连。 */
const API_ROOT = '/safevault'

/**
 * 后端基地址 = (生产经环境变量注入的源站 || 开发留空走同源 proxy) + 统一根 /safevault。
 * 生产仅需配置源站（如 https://api.example.com），无需在环境变量里重复带 /safevault。
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '') + API_ROOT

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
 * 发送带 JSON body 的请求（POST / PUT 共用核心）。
 * @param {'POST'|'PUT'} method HTTP 方法
 * @param {string} path 接口路径（以 / 开头）
 * @param {object} body 请求体，自动 JSON 序列化
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @param {object} [options.headers] 附加请求头（如鉴权 Authorization: Bearer <access>）。
 *                 与默认的 Content-Type 合并；同名键以传入值为准。
 * @returns {Promise<any>} 成功时解析后的响应体
 * @throws {Error} 非 2xx 时抛出，message 为后端 detail；附带 status 字段。
 *                 取消时抛出 name === 'AbortError' 的异常（由 fetch 透传）。
 */
async function sendJson(method, path, body, { signal, headers } = {}) {
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      // 默认 Content-Type 在前，附加 headers 在后——既保证 JSON 头默认存在，
      // 又允许调用方按需补充（如 Authorization）；保持向后兼容（不传 headers 行为不变）。
      headers: { 'Content-Type': 'application/json', ...headers },
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

/**
 * 发送 DELETE 请求（模块 2 删除云端备份 DELETE /backup 用），无请求体。
 *
 * 与 getJson 同构：DELETE 无 body / 不发 Content-Type，仅透传调用方附加头（如 Authorization）。
 * 复用 extractMessage 错误抽取与 status 透出；支持 401（access 过期，调用方续签重试）等带 status 的
 * 错误由调用方按语义分流。取消（AbortError）原样透传。
 * @param {string} path 接口路径（以 / 开头，如 /backup）
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @param {object} [options.headers] 附加请求头（如鉴权 Authorization: Bearer <access>）
 * @returns {Promise<any>} 成功时解析后的响应体（如 { deleted: true }）
 * @throws {Error} 非 2xx 时抛出，message 为后端 detail；附带 status 字段。
 */
export async function deleteJson(path, { signal, headers } = {}) {
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      // DELETE 无请求体，故不带 Content-Type；仅透传调用方附加头（如 Authorization）。
      headers: { ...headers },
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

/**
 * 发送 JSON POST 请求。
 * @param {string} path 接口路径（以 / 开头，如 /auth/verify-code）
 * @param {object} body 请求体，自动 JSON 序列化
 * @param {object} [options] 见 sendJson（signal / headers）
 * @returns {Promise<any>} 成功时解析后的响应体
 */
export function postJson(path, body, options) {
  return sendJson('POST', path, body, options)
}

/**
 * 发送 JSON PUT 请求（模块 2 覆盖式上传 PUT /backup 用）。
 * 与 postJson 同构，仅方法不同；同样支持 Authorization 头与 409/413 等带 status 的错误透出。
 * @param {string} path 接口路径（以 / 开头，如 /backup）
 * @param {object} body 请求体，自动 JSON 序列化
 * @param {object} [options] 见 sendJson（signal / headers）
 * @returns {Promise<any>} 成功时解析后的响应体
 */
export function putJson(path, body, options) {
  return sendJson('PUT', path, body, options)
}

/**
 * 发送 GET 请求（模块 2 下载快照 GET /backup 用），无请求体。
 *
 * 与 sendJson 共享错误抽取（extractMessage）与 status 透出，但 GET 无 body / 不发 Content-Type。
 * 同样支持 Authorization 头与 404（云端暂无备份）/ 401（access 过期）等带 status 的错误，由调用方
 * 按语义分流。取消（AbortError）原样透传。
 * @param {string} path 接口路径（以 / 开头，如 /backup）
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @param {object} [options.headers] 附加请求头（如鉴权 Authorization: Bearer <access>）
 * @returns {Promise<any>} 成功时解析后的响应体
 * @throws {Error} 非 2xx 时抛出，message 为后端 detail；附带 status 字段。
 */
export async function getJson(path, { signal, headers } = {}) {
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      // GET 无请求体，故不带 Content-Type；仅透传调用方附加头（如 Authorization）。
      headers: { ...headers },
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
