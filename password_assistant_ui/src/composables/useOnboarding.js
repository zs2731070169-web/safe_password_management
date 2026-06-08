/**
 * useOnboarding —— 新用户开户·步骤 1（设置主密码）交互编排
 *
 * 职责单一：封装「提交主密码 → loading → 成功/失败反馈 → 卸载时取消」。
 * 身份本身即首次开户，无需前置验证；提交成功后由视图切到步骤 2（保存恢复码）。
 * 步骤 2 直接复用 useRecoveryCode（生成 / 复制 / 存图），本组合式不涉及。
 *
 * 模式对齐 useChangePassword / useResetPassword：通过 AbortController 在组件卸载时取消请求。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

import { useAuthStore } from '@/stores/auth'

/**
 * @returns {{
 *   submitting: import('vue').Ref<boolean>,
 *   setupMasterPassword: (password: string) => Promise<boolean>,
 *   cleanup: () => void
 * }}
 */
export function useOnboarding() {
  const authStore = useAuthStore()

  /** 提交中标志 */
  const submitting = ref(false)
  /** 请求取消控制器 */
  let abortController = null

  /**
   * 提交并设置主密码（首次开户）。
   * @param {string} password 用户设置的主密码
   * @returns {Promise<boolean>} 成功返回 true
   */
  async function setupMasterPassword(password) {
    if (submitting.value) return false
    if (!password) {
      ElMessage.warning('请输入主密码')
      return false
    }

    // 取消前一个未完成的请求
    if (abortController) abortController.abort()
    abortController = new AbortController()

    submitting.value = true
    try {
      const ok = await authStore.setupMasterPassword(password, {
        signal: abortController.signal
      })
      return ok
    } catch (err) {
      // 主动取消不视为错误（组件卸载）
      if (err?.name === 'AbortError') return false
      ElMessage.error(err?.message || '设置失败，请稍后重试')
      return false
    } finally {
      submitting.value = false
    }
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
    setupMasterPassword,
    cleanup
  }
}
