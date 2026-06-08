/**
 * useIdentityVerify —— 敏感操作前的身份验证编排
 *
 * 通用「指纹 / 主密码」二选一验证：
 *   - 指纹：复用 services/biometric 的 scanBiometric，与登录解锁走完全相同的路径——
 *     真机拉起系统指纹框，浏览器/无插件降级 mock 延时；
 *   - 主密码：走 auth store 校验（比对开户时持久化的主密码，不改变解锁态）。
 * 任一方式通过即视为验证成功。沿用 AbortController 在卸载 / 关闭时取消进行中的请求。
 *
 * 复用方：删除条目（详情页）、重新生成恢复码（恢复码管理页）等。
 */
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { scanBiometric } from '@/services/biometric'

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

  /** 指纹验证（与登录解锁一致：真机系统指纹框 / 浏览器 mock） */
  async function verifyByBiometric() {
    return run('biometric', async (signal) => {
      const ok = await scanBiometric({ reason: '验证指纹以继续', signal })
      // 用户取消（系统框取消 / 浏览器关闭）：静默未通过，不作错误提示
      if (!ok) throw new DOMException('Aborted', 'AbortError')
      // scanBiometric 的真实错误（未录入 / 被锁定…）会自行抛出带中文 message 的 Error，
      // 由 run 捕获后落到 errorMsg 同界面提示。
    })
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
