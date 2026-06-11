/**
 * useCloudAccount —— 云账户认证流程编排（注册 / 登录 / 重置密码 / 发码）
 *
 * 把云账户 store 的异步动作包成 UI 友好的流程：统一 loading 态、ElMessage 反馈、
 * AbortController 取消（组件卸载时）。供「创建云账户」（开户）、「登录」（解锁）、
 * 「邮箱验证码重置密码」（找回）等全屏页复用。
 *
 * 视图只调用本组合式函数，不直接触碰 store 异步细节，与 useUnlock / useChangePassword 一致。
 */
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'

import { useCloudAccountStore } from '@/stores/cloudAccount'

/**
 * @returns {{
 *   sendingCode: import('vue').Ref<boolean>,
 *   authenticating: import('vue').Ref<boolean>,
 *   sendCode: (email: string) => Promise<boolean>,
 *   register: (payload: { email: string, password: string, code: string }) => Promise<boolean>,
 *   login: (payload: { email: string, password: string }) => Promise<boolean>,
 *   resetPassword: (payload: { code: string, newPassword: string }) => Promise<boolean>,
 *   refreshSession: () => Promise<boolean>,
 *   cleanup: () => void
 * }}
 */
export function useCloudAccount() {
  const store = useCloudAccountStore()
  const { sendingCode, authenticating } = storeToRefs(store)

  /** 请求取消控制器（组件卸载时中断进行中的请求） */
  let abortController = null

  /** 确保存在可用的 AbortController（复用同一个，串联发码 / 提交） */
  function ensureSignal() {
    if (!abortController) abortController = new AbortController()
    return abortController.signal
  }

  /**
   * 下发邮箱验证码（注册 / 重置共用）。已对接后端 POST /auth/verify-code，验证码经邮件下发。
   * 注意：register 与 resetPassword 均已真实接入（§2 / §6），请输入邮箱实收的真验证码。
   * @param {string} email 目标邮箱
   * @returns {Promise<boolean>} 是否下发成功
   */
  async function sendCode(email) {
    try {
      const ok = await store.sendVerifyCode(email, { signal: ensureSignal() })
      if (ok) ElMessage.success('验证码已发送，请查收邮箱')
      return ok
    } catch (err) {
      if (err?.name === 'AbortError') return false
      ElMessage.error(err?.message || '验证码发送失败，请重试')
      return false
    }
  }

  /**
   * 注册（创建云账户）。
   * @param {{ email: string, password: string, code: string }} payload
   * @returns {Promise<boolean>}
   */
  async function register(payload) {
    try {
      const ok = await store.register(payload, { signal: ensureSignal() })
      if (ok) ElMessage.success('云账户已创建')
      return ok
    } catch (err) {
      if (err?.name === 'AbortError') return false
      ElMessage.error(err?.message || '创建失败，请重试')
      return false
    }
  }

  /**
   * 登录已有云账户。
   * @param {{ email: string, password: string }} payload
   * @returns {Promise<boolean>}
   */
  async function login(payload) {
    try {
      return await store.login(payload, { signal: ensureSignal() })
    } catch (err) {
      if (err?.name === 'AbortError') return false
      ElMessage.error(err?.message || '登录失败，请重试')
      return false
    }
  }

  /**
   * 邮箱验证码重置密码（忘记密码流程）。
   * @param {{ code: string, newPassword: string }} payload
   * @returns {Promise<boolean>}
   */
  async function resetPassword(payload) {
    try {
      const ok = await store.resetPassword(payload, { signal: ensureSignal() })
      if (ok) ElMessage.success('密码已重置')
      return ok
    } catch (err) {
      if (err?.name === 'AbortError') return false
      ElMessage.error(err?.message || '重置失败，请重试')
      return false
    }
  }

  /**
   * 静默续签会话 token（对应 POST /auth/refresh，§4）。
   *
   * 用户无感：成功 / 失败均不弹 ElMessage（与时序图「静默续签，用户无感」一致）。
   * store.refresh() 内部已处理 401 登出（清登录态），上层据返回值决定后续（如导回登录页）。
   * @returns {Promise<boolean>} 续签成功返回 true，失败（含 401 / 网络）返回 false
   */
  async function refreshSession() {
    try {
      return await store.refresh({ signal: ensureSignal() })
    } catch (err) {
      // AbortError（组件卸载取消）等同未续签；静默吞掉，不打扰用户
      if (err?.name === 'AbortError') return false
      return false
    }
  }

  /** 清理：取消进行中的请求（组件卸载时调用） */
  function cleanup() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    sendingCode,
    authenticating,
    sendCode,
    register,
    login,
    resetPassword,
    refreshSession,
    cleanup
  }
}
