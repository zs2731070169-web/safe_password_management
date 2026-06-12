import { computed, onUnmounted } from 'vue'
import { navTo, navReplace } from '@/utils/navigation'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'
import { useCloudAccountStore } from '@/stores/cloudAccount'
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
 *   - 指纹登录：指纹只是「解锁安全区里存的主密码」的闸门——验证通过后取回主密码，走与密码
 *     登录**完全相同**的真实链路（cloudAccount.loginByBiometric → login），既拿合法 token 又
 *     能派生 DataKey 解密保险库。零知识库下绝不能只翻本地标志位（否则登录了却解不开自己的库）。
 *     入口仅在「已开启指纹且安全区有存档」时展示（见视图 hasBiometricCredential 闸门），故此处
 *     固定走 verify；录入仅在设置页进行。
 */
export function useUnlock() {
  const cloudStore = useCloudAccountStore()
  const { requestBiometric } = useBiometricPrompt()
  const { authenticating, login: cloudLogin, cleanup } = useCloudAccount()

  /** 对外透出的 loading（登录态；指纹流程由系统框 / 弹窗覆盖展示） */
  const loading = computed(() => authenticating.value)

  /** 指纹登录：指纹验证（闸门）→ 取回主密码走真实登录 → 进入密码库 */
  async function loginByBiometric() {
    // 1) 指纹闸门：通过才允许取回安全区凭据（mock 阶段闸门在此，真机由 Keychain 读取自带指纹保护）
    const ok = await requestBiometric('verify')
    if (!ok) return
    // 2) 取回主密码走与密码登录同一条真实链路（拿 token + 落主密码供解密）
    const success = await cloudStore.loginByBiometric()
    if (success) {
      navTo('Vault')
    } else {
      // 存档失效（如他处改过密，已自动清除并关闭指纹）或网络异常：回退密码登录
      toastError('指纹登录失败，请改用密码登录')
    }
  }

  /** 密码登录：邮箱 + 密码 */
  async function loginByPassword({ email, password }) {
    if (!email) {
      toastInfo('请输入邮箱')
      return false
    }
    if (!password) {
      toastInfo('请输入密码')
      return false
    }
    if (authenticating.value) return false
    const ok = await cloudLogin({ email: email.trim(), password })
    if (ok) navTo('Vault')
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
