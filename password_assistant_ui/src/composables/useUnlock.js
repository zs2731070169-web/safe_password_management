import { computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { useSettingsStore } from '@/stores/settings'
import { useCloudAccount } from '@/composables/useCloudAccount'
import { useBiometricPrompt } from '@/composables/useBiometricPrompt'

/**
 * useUnlock —— 登录交互组合式函数
 *
 * 统一身份后「解锁」即「登录云账户」：编排「触发登录 → loading → 成功/失败反馈 →
 * 卸载时取消」。视图层只关心调用与展示，不直接接触 store / 取消逻辑。
 *
 * 两种方式：
 *   - 密码登录：邮箱 + 密码校验（cloudAccount.login）；
 *   - 指纹登录：身份由系统指纹确认，直接 markLoggedIn 进入密码库（前提已注册账户）。
 */
export function useUnlock() {
  const cloudStore = useCloudAccountStore()
  const settingsStore = useSettingsStore()
  const { requestBiometric } = useBiometricPrompt()
  const { authenticating, login: cloudLogin, cleanup } = useCloudAccount()
  const router = useRouter()

  /** 对外透出的 loading（密码登录态；指纹流程由系统框 / 弹窗覆盖展示） */
  const loading = computed(() => authenticating.value)

  /** 指纹登录：身份由系统指纹确认，通过后直接登录进入密码库 */
  async function loginByBiometric() {
    const enrolled = settingsStore.biometric
    const ok = await requestBiometric(enrolled ? 'verify' : 'enroll')
    if (!ok) return
    // 首次录入通过：开启指纹解锁（持久化），下次直接走验证
    if (!enrolled) settingsStore.setBiometric(true)
    cloudStore.markLoggedIn()
    router.push({ name: 'Vault' })
  }

  /** 密码登录：邮箱 + 密码 */
  async function loginByPassword({ email, password }) {
    if (!email) {
      ElMessage.warning('请输入邮箱')
      return false
    }
    if (!password) {
      ElMessage.warning('请输入密码')
      return false
    }
    if (authenticating.value) return false
    const ok = await cloudLogin({ email: email.trim(), password })
    if (ok) router.push({ name: 'Vault' })
    return ok
  }

  // 组件卸载时中断未完成的登录，避免无效回调
  onUnmounted(cleanup)

  return {
    loading,
    loginByBiometric,
    loginByPassword
  }
}
