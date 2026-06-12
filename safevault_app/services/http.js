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
 * App 端开发期默认后端地址（仅 App 逻辑层 uni.request 用，经条件编译注入）。
 *
 * 为何需要它：App 端无 Vite dev 代理，逻辑层跑独立 JS 引擎，uni.request **必须**用带 scheme 的
 * 绝对地址；若沿用 H5 的同源相对路径（''），请求发不出去——后端收不到、且不报错（无 toast），
 * 表现为「点登录无任何反应」。故 App 默认直连后端绝对地址。
 *
 * 默认值面向 **Android 模拟器**：`10.0.2.2` 是模拟器映射到宿主机回环（= 电脑的 127.0.0.1）的特殊地址。
 * 其它运行目标改这里即可：
 *   - iOS 模拟器：'http://localhost:8000'（与宿主共享网络）；
 *   - 真机调试：电脑局域网 IP（如 'http://192.168.1.10:8000'），且后端须监听 0.0.0.0（默认仅 127.0.0.1）。
 * 生产 / 正式 APK 由构建期 VITE_API_BASE_URL 注入真实源站，优先级高于此默认值（见下方 BASE_URL）。
 */
const APP_DEV_API_BASE = 'http://127.0.0.1:8000'

/**
 * 后端基地址 = (生产经环境变量注入的源站 || App 开发默认绝对地址 || H5 留空走同源 proxy) + 统一根 /safevault。
 * 生产仅需配置源站（如 https://api.example.com），无需在环境变量里重复带 /safevault。
 */
const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || APP_DEV_API_BASE || '').replace(/\/+$/, '') + API_ROOT

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

// #ifdef APP-PLUS
/**
 * App 端底层请求实现：用 uni.request 还原 fetch + AbortSignal 的对外契约。
 *
 * 为何不用 fetch：App 端（app-plus）逻辑层跑在独立 JS 引擎（V8/JSCore），**无 fetch**。
 * uni.request 是 uni 提供的跨端网络 API，返回 RequestTask，其 abort() 对齐 fetch 的取消语义。
 *
 * 严格对齐 H5 fetch 分支的对外行为，保证上层（cloudBackup / cloudAccount）零感知：
 *   - 取消：监听传入 signal 的 abort，调 task.abort()；并抛出 name==='AbortError' 的异常（与 fetch 同）。
 *   - 网络失败（断网 / 后端未启动）：抛 Error('网络异常，请检查连接后重试')（与 H5 catch 分支同文案）。
 *   - 成功：解析 JSON body；非 2xx 时抛 Error(extractMessage(...))，并附 .status（与 H5 分支同结构）。
 *
 * uni.request 已自动按 Content-Type 解析 JSON（data 即对象），故无需再 res.json()。
 *
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} url 完整 URL
 * @param {object|undefined} body 请求体对象（GET/DELETE 传 undefined）
 * @param {object} headers 请求头
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Promise<any>} 解析后的响应体
 */
function uniRequest(method, url, body, headers, signal) {
  return new Promise((resolve, reject) => {
    // 进入即已取消：构造 AbortError 立即拒绝（对齐 fetch 在已 abort 信号下的行为）
    if (signal?.aborted) {
      const err = new Error('请求已取消')
      err.name = 'AbortError'
      reject(err)
      return
    }

    // 取消竞态标志：声明在 uni.request 之前，供 success/fail 回调与 abort 监听共享
    let aborted = false

    const task = uni.request({
      url,
      method,
      header: headers,
      data: body, // GET/DELETE 传 undefined 即不带 body
      // 不让 uni 把非 2xx 当失败：statusCode 一律进 success，由我们按 res.ok 逻辑分流，对齐 fetch
      success: (res) => {
        if (aborted) return // 取消竞态：已 abort 则丢弃迟到的成功回调
        const status = res.statusCode
        const data = res.data ?? null
        if (status >= 200 && status < 300) {
          resolve(data)
          return
        }
        const error = new Error(extractMessage(data, status))
        error.status = status
        reject(error)
      },
      fail: (err) => {
        // uni.request 取消（task.abort()）会走 fail，errMsg 含 'abort'；归一为 AbortError 对齐 fetch
        if (aborted || /abort/i.test(err?.errMsg || '')) {
          const e = new Error('请求已取消')
          e.name = 'AbortError'
          reject(e)
          return
        }
        // 其余为真实网络层失败（断网 / 后端未启动 / DNS）
        reject(new Error('网络异常，请检查连接后重试'))
      }
    })

    // 取消语义还原：signal abort → task.abort()（RequestTask 取消在途请求）
    if (signal) {
      const onAbort = () => {
        aborted = true
        try {
          task.abort()
        } catch (_) {
          /* 任务已结束时 abort 可能抛错，忽略 */
        }
      }
      signal.addEventListener('abort', onAbort)
    }
  })
}
// #endif

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
  // 默认 Content-Type 在前，附加 headers 在后——既保证 JSON 头默认存在，
  // 又允许调用方按需补充（如 Authorization）；保持向后兼容（不传 headers 行为不变）。
  const reqHeaders = { 'Content-Type': 'application/json', ...headers }

  // #ifdef APP-PLUS
  // App 端无 fetch：走 uni.request 还原同样的取消 / 错误 / 返回契约（见 uniRequest）。
  return uniRequest(method, `${BASE_URL}${path}`, body, reqHeaders, signal)
  // #endif

  // #ifndef APP-PLUS
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: reqHeaders,
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
  // #endif
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
  // #ifdef APP-PLUS
  // App 端：uni.request 还原 DELETE（无 body / 仅透传附加头），契约与 H5 fetch 分支一致。
  return uniRequest('DELETE', `${BASE_URL}${path}`, undefined, { ...headers }, signal)
  // #endif

  // #ifndef APP-PLUS
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
  // #endif
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
  // #ifdef APP-PLUS
  // App 端：uni.request 还原 GET（无 body / 仅透传附加头），契约与 H5 fetch 分支一致。
  return uniRequest('GET', `${BASE_URL}${path}`, undefined, { ...headers }, signal)
  // #endif

  // #ifndef APP-PLUS
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
  // #endif
}
