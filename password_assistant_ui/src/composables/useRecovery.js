/**
 * useRecovery —— 恢复码验证逻辑
 *
 * 封装恢复码验证的异步操作、加载态与错误处理。
 * 遵循 useUnlock.js 的模式：通过 AbortController 在组件卸载时取消进行中的请求。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRecoveryStore } from '@/stores/recovery'

/**
 * 恢复码验证状态与操作
 *
 * @returns {{
 *   verifying: Ref<boolean>,
 *   errorMsg: Ref<string>,
 *   verifyRecoveryCode: (code: string) => Promise<boolean>
 * }}
 */
export function useRecovery() {
  const recoveryStore = useRecoveryStore()

  /** 验证中标志 */
  const verifying = ref(false)
  /** 错误信息 */
  const errorMsg = ref('')
  /** 请求取消控制器 */
  let abortController = null

  /**
   * 验证恢复码
   * @param {string} code - 格式化后的恢复码（XXXXX-XXXXX-XXXXX-XXXXX-XXXXX）
   * @returns {Promise<boolean>} - 验证成功返回 true
   */
  async function verifyRecoveryCode(code) {
    // 取消前一个未完成的请求
    if (abortController) {
      abortController.abort()
    }
    abortController = new AbortController()

    verifying.value = true
    errorMsg.value = ''

    try {
      // TODO: 替换为真实 API 调用
      // 模拟 API 验证延迟（1.5秒）
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 1500)
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })

      // 与当前生效的恢复码比对（默认码或恢复码管理页重新生成的码，见 stores/recovery）
      if (recoveryStore.verify(code)) {
        ElMessage.success('恢复码验证成功')
        return true
      } else {
        errorMsg.value = '恢复码无效，请检查后重新输入'
        ElMessage.error('恢复码无效')
        return false
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // 请求被取消，不显示错误
        return false
      }
      errorMsg.value = '验证失败，请稍后重试'
      ElMessage.error('验证失败，请稍后重试')
      return false
    } finally {
      verifying.value = false
    }
  }

  /**
   * 清理函数：组件卸载时取消进行中的请求
   */
  function cleanup() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    verifying,
    errorMsg,
    verifyRecoveryCode,
    cleanup
  }
}