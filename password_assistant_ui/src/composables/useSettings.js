/**
 * useSettings —— 设置页交互编排
 *
 * 转发设置项的读写到 settings store，并承接各类交互反馈：
 *   - 生物识别解锁：开启需录入指纹、关闭需先验证指纹通过（toggleBiometric，复用全局指纹弹窗）；
 *   - 其余布尔开关（深色模式 / 账号脱敏）：直接切换并持久化（深色由 useTheme 监听 store 即时换肤）；
 *   - 自动锁定时长：行项就地展开下拉框（SettingItem 自绘浮层），点选某项即调用 setAutoLock 回填；
 *   - 预留功能项（修改主密码 / 恢复码管理 / 加密导出导入 / 回收站）：统一 ElMessage.info 占位。
 *
 * 视图只调用本组合式函数，不直接触碰 store / 弹窗（与 useGenerator、useResetPassword 等保持一致）。
 * main.js 已引入 el-message 样式，可直接用 ElMessage。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'

import { useSettingsStore, AUTO_LOCK_OPTIONS } from '@/stores/settings'
import { useBiometricPrompt } from '@/composables/useBiometricPrompt'

/**
 * @returns {{
 *   biometric: import('vue').Ref<boolean>,
 *   darkMode: import('vue').Ref<boolean>,
 *   maskAccount: import('vue').Ref<boolean>,
 *   autoLockSeconds: import('vue').Ref<number>,
 *   trashCount: import('vue').Ref<number>,
 *   autoLockOptions: Array<{ value: number, label: string }>,
 *   autoLockLabel: import('vue').ComputedRef<string>,
 *   toggleSwitch: (key: string) => void,
 *   toggleBiometric: () => Promise<void>,
 *   setAutoLock: (seconds: number) => void,
 *   placeholder: (label: string) => void
 * }}
 */
export function useSettings() {
  const store = useSettingsStore()
  const router = useRouter()
  const { requestBiometric } = useBiometricPrompt()
  const {
    biometric,
    autoLockSeconds,
    darkMode,
    maskAccount,
    trashCount
  } = storeToRefs(store)

  /** 关闭后需给风险提示的安全开关（DRD：关闭生物识别给出风险提示） */
  const RISK_HINT = {
    biometric: '已关闭生物识别解锁，下次需用主密码进入'
  }

  /** 当前自动锁定时长对应的展示文案（行项右侧值） */
  const autoLockLabel = computed(
    () =>
      AUTO_LOCK_OPTIONS.find((opt) => opt.value === autoLockSeconds.value)?.label ?? '永不锁定'
  )

  /**
   * 切换布尔开关并按需给出反馈。
   * 深色模式由 useTheme 监听 store 即时换肤（整屏翻转即反馈，无需额外提示）；
   * 账号脱敏直接生效。
   * @param {'darkMode'|'maskAccount'} key 开关键名
   */
  function toggleSwitch(key) {
    store.toggle(key)
    // 切换后的最新值（store 同名 ref 已更新）
    const refMap = { biometric, darkMode, maskAccount }
    const nowOn = refMap[key]?.value

    // 安全开关「关闭」时给风险提示（warning）
    if (!nowOn && RISK_HINT[key]) {
      ElMessage.warning(RISK_HINT[key])
    }
  }

  /**
   * 切换生物识别解锁：
   *  - 当前已开启 → 关闭前必须重新验证指纹，通过后才真正关闭并给风险提示；
   *  - 当前未开启 → 录入指纹，通过后开启。
   * 验证 / 录入未通过则保持原状（开关受控，不翻转）。
   */
  async function toggleBiometric() {
    if (biometric.value) {
      const ok = await requestBiometric('verify')
      if (!ok) return
      store.setBiometric(false)
      ElMessage.warning(RISK_HINT.biometric)
    } else {
      const ok = await requestBiometric('enroll')
      if (!ok) return
      store.setBiometric(true)
      ElMessage.success('已开启生物识别解锁')
    }
  }

  /**
   * 设置自动锁定时长（下拉框点选某项时调用，仅接受合法选项值）。
   * @param {number} seconds 目标秒数（须在 AUTO_LOCK_OPTIONS 内）
   */
  function setAutoLock(seconds) {
    store.setAutoLockSeconds(seconds)
  }

  /**
   * 预留功能项占位提示（修改主密码 / 加密导出导入）。
   * @param {string} label 功能名（用于提示文案）
   */
  function placeholder(label) {
    ElMessage.info(`${label}功能正在开发中`)
  }

  /** 进入修改主密码页 */
  function openChangePassword() {
    router.push({ name: 'ChangeMasterPassword' })
  }

  /** 进入恢复码管理（重新生成并保存）页 */
  function openRecoveryCode() {
    router.push({ name: 'RecoveryCodeManage' })
  }

  /** 进入回收站页 */
  function openTrash() {
    router.push({ name: 'Trash' })
  }

  return {
    // 状态（来自 store）
    biometric,
    autoLockSeconds,
    darkMode,
    maskAccount,
    trashCount,
    autoLockOptions: AUTO_LOCK_OPTIONS,
    autoLockLabel,
    // 方法
    toggleSwitch,
    toggleBiometric,
    setAutoLock,
    placeholder,
    openChangePassword,
    openRecoveryCode,
    openTrash
  }
}
