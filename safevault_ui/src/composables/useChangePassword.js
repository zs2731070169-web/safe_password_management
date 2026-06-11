/**
 * useChangePassword —— 修改账户密码逻辑编排
 *
 * 设置页「安全 → 修改账户密码」专用：身份验证（指纹 / 旧密码）由页面前置的
 * IdentityVerifyModal 完成，本组合式函数只负责「设置新密码」的异步提交、加载态、
 * AbortController（组件卸载时取消进行中的请求）与反馈提示。
 *
 * 视图只调用本组合式函数，不直接触碰 store。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

import { useCloudAccountStore } from '@/stores/cloudAccount'
import { useGeneratorStore } from '@/stores/generator'

/**
 * @returns {{
 *   submitting: import('vue').Ref<boolean>,
 *   changePassword: (newPassword: string) => Promise<{ ok: boolean }>,
 *   generatePassword: () => string,
 *   cleanup: () => void
 * }}
 */
export function useChangePassword() {
  const cloudStore = useCloudAccountStore()
  const generatorStore = useGeneratorStore()

  /** 提交中标志 */
  const submitting = ref(false)
  /** 请求取消控制器 */
  let abortController = null

  /**
   * 提交新账户密码（身份已由前置验证界面确认）
   * @param {string} newPassword 新密码
   * @returns {Promise<{ ok: boolean }>} ok 为是否成功
   */
  async function changePassword(newPassword) {
    if (submitting.value) return { ok: false }

    // 取消前一个未完成的请求
    if (abortController) abortController.abort()
    abortController = new AbortController()

    submitting.value = true
    try {
      await cloudStore.changePassword(newPassword, {
        signal: abortController.signal
      })
      ElMessage.success('密码修改成功，请用新密码重新登录')
      return { ok: true }
    } catch (err) {
      // 主动取消不视为错误（组件卸载）
      if (err?.name === 'AbortError') return { ok: false }
      ElMessage.error(err?.message || '修改失败，请稍后重试')
      return { ok: false }
    } finally {
      submitting.value = false
    }
  }

  /**
   * 一键生成强随机密码
   * 委托生成器 store，沿用用户在「生成」Tab 中保存的规则（长度 + 字符集开关）。
   * 用户从未调整过时为默认规则（16 位、大小写 + 数字 + 符号）。
   * @returns {string} 生成的密码；规则无任何可用字符集时返回空串
   */
  function generatePassword() {
    return generatorStore.generate()
  }

  /** 清理：组件卸载时取消进行中的请求 */
  function cleanup() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    submitting,
    changePassword,
    generatePassword,
    cleanup
  }
}
