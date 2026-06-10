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
   * 注意：register / resetPassword 后端尚未实现，仍 mock 校验固定 123456（见 stores/cloudAccount.js
   * 过渡期说明）；演示注册 / 重置请输入 123456，而非邮箱实收的真码。
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
    cleanup
  }
}
