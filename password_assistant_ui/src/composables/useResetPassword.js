/**
 * useResetPassword —— 重设主密码逻辑
 *
 * 封装重置主密码的异步提交、加载态与反馈。
 * 遵循 useRecovery.js 的模式：通过 AbortController 在组件卸载时取消进行中的请求。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

/**
 * @returns {{
 *   resetting: Ref<boolean>,
 *   resetMasterPassword: (newPassword: string) => Promise<boolean>,
 *   cleanup: () => void
 * }}
 */
export function useResetPassword() {
  /** 重置提交中标志 */
  const resetting = ref(false)
  /** 请求取消控制器 */
  let abortController = null

  /**
   * 提交新主密码
   * @param {string} newPassword - 新主密码明文
   * @returns {Promise<boolean>} - 成功返回 true
   */
  async function resetMasterPassword(newPassword) {
    if (resetting.value) return false

    // 取消前一个未完成的请求
    if (abortController) abortController.abort()
    abortController = new AbortController()

    resetting.value = true

    try {
      // TODO: 替换为真实 API 调用
      // 模拟重置延迟（1.5 秒）
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1500)
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })

      ElMessage.success('主密码已重置')
      return true
    } catch (err) {
      if (err.name === 'AbortError') return false
      ElMessage.error('重置失败，请稍后重试')
      return false
    } finally {
      resetting.value = false
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
    resetting,
    resetMasterPassword,
    cleanup
  }
}
