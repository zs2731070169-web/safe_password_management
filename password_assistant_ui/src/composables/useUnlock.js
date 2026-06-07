import { ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useBiometricPrompt } from '@/composables/useBiometricPrompt'

/**
 * useUnlock —— 解锁交互组合式函数
 *
 * 职责单一：编排「触发解锁 → loading → 成功/失败反馈 → 卸载时取消」。
 * 视图层只关心调用与展示，不直接接触 store / 取消逻辑。
 *
 * 指纹解锁：未录入（settings.biometric=false）→ 走「录入」流程，通过后开启指纹解锁；
 * 已录入 → 走「验证」流程。两者均由全局指纹弹窗（useBiometricPrompt）承载交互，
 * 通过后调用 auth.markUnlocked 置为已解锁并进入密码库。
 */
export function useUnlock() {
  const authStore = useAuthStore()
  const settingsStore = useSettingsStore()
  const { requestBiometric } = useBiometricPrompt()
  const router = useRouter()

  // 当前进行中的取消控制器（主密码路径），用于组件卸载或重复触发时中断
  let controller = null

  /** 主密码解锁中状态 */
  const masterLoading = ref(false)
  /** 对外透出的 loading（指纹流程由弹窗覆盖展示，这里只反映主密码态） */
  const loading = computed(() => masterLoading.value || authStore.unlocking)

  /** 重置控制器 */
  function resetController() {
    controller?.abort()
    controller = new AbortController()
    return controller.signal
  }

  /** 生物识别解锁：首次录入 / 已录入验证，通过后解锁进入密码库 */
  async function unlockByBiometric() {
    const enrolled = settingsStore.biometric
    const ok = await requestBiometric(enrolled ? 'verify' : 'enroll')
    if (!ok) return
    // 首次录入通过：开启指纹解锁（持久化），下次直接走验证
    if (!enrolled) settingsStore.setBiometric(true)
    authStore.markUnlocked()
    router.push({ name: 'Vault' })
  }

  /** 主密码解锁 */
  async function unlockByMasterPassword(password) {
    if (!password) {
      ElMessage.warning('请输入主密码')
      return false
    }
    if (authStore.unlocking) return false
    masterLoading.value = true
    const signal = resetController()
    const ok = await authStore.unlockByMasterPassword(password, { signal })
    masterLoading.value = false
    handleResult(ok)
    return ok
  }

  /** 统一处理解锁结果反馈：成功直接进入密码库（不弹提示），仅失败时反馈错误 */
  function handleResult(ok) {
    if (ok) {
      // 解锁成功，跳转密码库主界面
      router.push({ name: 'Vault' })
    } else if (authStore.lastError) {
      ElMessage.error(authStore.lastError)
    }
  }

  // 组件卸载时中断未完成的解锁，避免内存泄漏与无效回调
  onUnmounted(() => {
    controller?.abort()
    controller = null
  })

  return {
    loading,
    unlockByBiometric,
    unlockByMasterPassword
  }
}
