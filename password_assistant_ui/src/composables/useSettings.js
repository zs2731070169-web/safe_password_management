/**
 * useSettings —— 设置页交互编排
 *
 * 转发设置项的读写到 settings store，并承接各类交互反馈：
 *   - 生物识别解锁：开启需录入指纹、关闭需先验证指纹通过（toggleBiometric，复用全局指纹弹窗）；
 *   - 其余布尔开关（账号脱敏）：直接切换并持久化；
 *   - 自动锁定时长：行项就地展开下拉框（SettingItem 自绘浮层），点选某项即调用 setAutoLock 回填；
 *   - 预留功能项（修改主密码 / 恢复码管理 / 加密导出导入 / 回收站）：统一 ElMessage.info 占位。
 *
 * 视图只调用本组合式函数，不直接触碰 store / 弹窗（与 useGenerator、useResetPassword 等保持一致）。
 * main.js 已引入 el-message 样式，可直接用 ElMessage。
 */
import { computed, ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'

import { useSettingsStore, AUTO_LOCK_OPTIONS } from '@/stores/settings'
import { useBiometricPrompt } from '@/composables/useBiometricPrompt'

/**
 * @returns {{
 *   biometric: import('vue').Ref<boolean>,
 *   maskAccount: import('vue').Ref<boolean>,
 *   cloudBackup: import('vue').Ref<boolean>,
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
    maskAccount,
    cloudBackup,
    trashCount
  } = storeToRefs(store)

  /** 当前自动锁定时长对应的展示文案（行项右侧值） */
  const autoLockLabel = computed(
    () =>
      AUTO_LOCK_OPTIONS.find((opt) => opt.value === autoLockSeconds.value)?.label ?? '永不锁定'
  )

  /**
   * 切换布尔开关（账号脱敏 / 云备份）：直接生效并持久化，不再弹顶部提示。
   * @param {'maskAccount'|'cloudBackup'} key 开关键名
   */
  function toggleSwitch(key) {
    store.toggle(key)
  }

  /**
   * 切换生物识别解锁：
   *  - 当前已开启 → 关闭前必须重新验证指纹，通过后才真正关闭；
   *  - 当前未开启 → 录入指纹，通过后开启。
   * 验证 / 录入未通过则保持原状（开关受控，不翻转）。切换结果不弹顶部提示。
   */
  async function toggleBiometric() {
    if (biometric.value) {
      const ok = await requestBiometric('verify')
      if (!ok) return
      store.setBiometric(false)
    } else {
      const ok = await requestBiometric('enroll')
      if (!ok) return
      store.setBiometric(true)
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

  // ---- 敏感页前置身份验证（在设置页就地完成，验证通过才跳转）----
  // 这样取消时不发生路由跳转，避免「先滑入空白页、取消后再滑回」的白屏间隔。
  /** 主密码兜底验证弹窗状态（仅未开启指纹时使用；标题/提示随目标功能切换） */
  const verify = reactive({ visible: false, title: '', hint: '' })
  /** 当前等待中的验证 Promise 决议器（主密码弹窗路径用） */
  let verifyResolve = null

  /**
   * 前置身份验证（与「生物识别解锁」设置一致，单一方式不混用）：
   *   已开启指纹 → 拉起系统指纹框，返回是否通过；
   *   未开启指纹 → 打开主密码兜底弹窗，等待用户验证 / 取消。
   * @param {{ title: string, hint: string }} opts 主密码弹窗文案
   * @returns {Promise<boolean>} 是否通过
   */
  async function requireIdentity({ title, hint }) {
    if (biometric.value) {
      return requestBiometric('verify')
    }
    // 主密码路径：打开弹窗并等待结果
    verify.title = title
    verify.hint = hint
    verify.visible = true
    return new Promise((resolve) => {
      verifyResolve = resolve
    })
  }

  /** 主密码弹窗验证通过 */
  function onIdentityVerified() {
    verify.visible = false
    verifyResolve?.(true)
    verifyResolve = null
  }

  /** 主密码弹窗显隐变更：被关闭（取消 / ESC / 遮罩）即视为未通过 */
  function onIdentityVisibleChange(val) {
    verify.visible = val
    if (!val && verifyResolve) {
      verifyResolve(false)
      verifyResolve = null
    }
  }

  /** 进入修改主密码页（验证通过后跳转） */
  async function openChangePassword() {
    const ok = await requireIdentity({
      title: '验证身份以修改主密码',
      hint: '修改后请牢记新主密码，旧密码将立即失效。'
    })
    if (ok) router.push({ name: 'ChangeMasterPassword' })
  }

  /** 进入恢复码管理（重新生成并保存）页（验证通过后跳转） */
  async function openRecoveryCode() {
    const ok = await requireIdentity({
      title: '验证身份以管理恢复码',
      hint: '重新生成后旧恢复码将立即失效，请确认本人操作。'
    })
    if (ok) router.push({ name: 'RecoveryCodeManage' })
  }

  /** 进入回收站页 */
  function openTrash() {
    router.push({ name: 'Trash' })
  }

  return {
    // 状态（来自 store）
    biometric,
    autoLockSeconds,
    maskAccount,
    cloudBackup,
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
    openTrash,
    // 前置身份验证（主密码兜底弹窗）状态与回调
    verify,
    onIdentityVerified,
    onIdentityVisibleChange
  }
}
