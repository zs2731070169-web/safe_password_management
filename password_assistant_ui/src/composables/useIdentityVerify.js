/**
 * useIdentityVerify —— 敏感操作前的身份验证编排
 *
 * 通用「指纹 / 主密码」二选一验证：
 *   - 指纹：mock（1.2s 后通过），真机由 services/biometric 接管；
 *   - 主密码：走 auth store 校验（默认 123456，不改变解锁态）。
 * 任一方式通过即视为验证成功。沿用 AbortController 在卸载 / 关闭时取消进行中的请求。
 *
 * 复用方：删除条目（详情页）、重新生成恢复码（恢复码管理页）等。
 */
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

export function useIdentityVerify() {
  const authStore = useAuthStore()

  /** 验证中标志 */
  const verifying = ref(false)
  /** 当前进行中的方式：'biometric' | 'password' | ''（用于按钮区分 loading） */
  const activeMethod = ref('')
  /** 错误提示（同界面展示） */
  const errorMsg = ref('')
  /** 请求取消控制器 */
  let abortController = null

  /** 指纹验证（mock：1.2s 后通过） */
  async function verifyByBiometric() {
    return run('biometric', (signal) => mockBiometricDelay(signal))
  }

  /** 主密码验证 */
  async function verifyByPassword(password) {
    if (!password) {
      errorMsg.value = '请输入主密码'
      return false
    }
    return run('password', async (signal) => {
      const ok = await authStore.verifyMasterPassword(password, { signal })
      if (!ok) throw new Error('主密码不正确')
    })
  }

  /** 统一封装：loading / 错误 / 取消 */
  async function run(method, task) {
    if (verifying.value) return false

    if (abortController) abortController.abort()
    abortController = new AbortController()

    verifying.value = true
    activeMethod.value = method
    errorMsg.value = ''

    try {
      await task(abortController.signal)
      return true
    } catch (err) {
      if (err?.name === 'AbortError') return false
      errorMsg.value = err?.message || '验证失败，请重试'
      return false
    } finally {
      verifying.value = false
      activeMethod.value = ''
    }
  }

  /** 清理：取消进行中的请求并复位状态 */
  function cleanup() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    verifying.value = false
    activeMethod.value = ''
    errorMsg.value = ''
  }

  return {
    verifying,
    activeMethod,
    errorMsg,
    verifyByBiometric,
    verifyByPassword,
    cleanup
  }
}

/** 可被 AbortSignal 中断的指纹验证延时（mock） */
function mockBiometricDelay(signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 1200)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}
