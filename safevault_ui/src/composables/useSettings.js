/**
 * useSettings —— 设置页交互编排
 *
 * 转发设置项的读写到 settings store，并承接各类交互反馈：
 *   - 云账户：顶部卡片展示（邮箱 / 登录态）+ 底部退出登录（软登出，回登录页）；
 *   - 生物识别解锁：开启需录入指纹、关闭需先验证指纹通过（toggleBiometric，复用全局指纹弹窗）；
 *   - 其余布尔开关（账号脱敏 / 云备份）：直接切换并持久化；
 *   - 自动锁定时长：行项就地展开下拉框（SettingItem 自绘浮层），点选某项即调用 setAutoLock 回填；
 *   - 修改账户密码：前置身份验证（指纹 / 账户密码），通过后跳转；加密导出导入：占位提示。
 *
 * 视图只调用本组合式函数，不直接触碰 store / 弹窗（与 useGenerator 等保持一致）。
 * main.js 已引入 el-message 样式，可直接用 ElMessage。
 */
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'

import { useSettingsStore, AUTO_LOCK_OPTIONS } from '@/stores/settings'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { useBiometricPrompt } from '@/composables/useBiometricPrompt'
import { useCloudRestore } from '@/composables/useCloudRestore'
import { useDeleteBackup } from '@/composables/useDeleteBackup'

export function useSettings() {
  const store = useSettingsStore()
  const cloudStore = useCloudAccountStore()
  const router = useRouter()
  const { requestBiometric } = useBiometricPrompt()
  // 云端恢复（模块 2 GET /backup）：二次确认 + 下载解密 + 覆盖本地库，编排封装在专用 composable
  const { restoring: restoringFromCloud, restoreFromCloud } = useCloudRestore()
  // 云端备份删除（模块 2 DELETE /backup，方案 A：与开关解耦）：二次确认后彻底销毁云端备份，编排封装在专用 composable
  const { deleting: deletingBackup, deleteCloudBackup } = useDeleteBackup()
  const {
    biometric,
    autoLockSeconds,
    maskAccount,
    cloudBackup,
    trashCount
  } = storeToRefs(store)
  // 云账户状态：登录态与脱敏邮箱（供顶部账户卡片展示与退出登录使用）；
  // pendingRecovery：重置后跳过恢复的「数据待恢复」态，供设置页常驻再入口与各处守卫判断。
  const {
    loggedIn: cloudLoggedIn,
    maskedEmail: cloudEmail,
    pendingRecovery
  } = storeToRefs(cloudStore)

  /** 当前自动锁定时长对应的展示文案（行项右侧值） */
  const autoLockLabel = computed(
    () =>
      AUTO_LOCK_OPTIONS.find((opt) => opt.value === autoLockSeconds.value)?.label ?? '永不锁定'
  )

  /**
   * 切换布尔开关（账号脱敏 / 云备份）：直接生效并持久化，不再弹顶部提示。
   *
   * 云备份守卫：「数据待恢复」态下没有会话 DataKey，开启云备份也只会被 pushSnapshot 静默跳过
   * （正是用户遇到的「开了却不备份」）。故此时拦截开启动作，引导先恢复 / 重建，避免开关形同虚设。
   * @param {'maskAccount'|'cloudBackup'} key 开关键名
   */
  function toggleSwitch(key) {
    if (key === 'cloudBackup' && !cloudBackup.value && pendingRecovery.value) {
      ElMessage.warning('数据待恢复，请先恢复或重建数据后再开启云备份')
      router.push({ name: 'RecoverData' })
      return
    }
    store.toggle(key)
  }

  /**
   * 切换生物识别解锁：
   *  - 当前已开启 → 关闭前必须重新验证指纹，通过后清除安全区凭据（clearBiometricCredential
   *    内部联动关闭设置项）；
   *  - 当前未开启 → 录入指纹，通过后把当前主密码写入安全区（saveBiometricCredential 内部联动
   *    开启设置项），使后续可指纹登录（零知识库下指纹需取回主密码才能解密，不能只翻标志位）。
   * 验证 / 录入未通过则保持原状（开关受控，不翻转）。切换结果不弹顶部提示。
   */
  async function toggleBiometric() {
    if (biometric.value) {
      const ok = await requestBiometric('verify')
      if (!ok) return
      cloudStore.clearBiometricCredential()
    } else {
      const ok = await requestBiometric('enroll')
      if (!ok) return
      // 写入安全区需当前已登录且持有主密码；缺失（异常态）则提示并不翻转开关
      const saved = cloudStore.saveBiometricCredential()
      if (!saved) {
        ElMessage.error('未能开启指纹登录，请重新登录后再试')
      }
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
   * 预留功能项占位提示（加密导出导入）。
   * @param {string} label 功能名（用于提示文案）
   */
  function placeholder(label) {
    ElMessage.info(`${label}功能正在开发中`)
  }

  /**
   * 退出登录：调后端吊销会话（POST /auth/logout，§7）+ 清本地会话与 refresh，回登录页。
   * store.logout 已做本地优先兜底（后端失败也必清本地登录态），故此处恒会进入「已退出」分支。
   * 二次确认由视图 ConfirmSheet 负责。
   */
  async function logout() {
    await cloudStore.logout()
    ElMessage.success('已退出登录')
    router.replace({ name: 'Unlock' })
  }

  // ---- 敏感页前置身份验证（在设置页就地完成，验证通过才跳转）----
  // 这样取消时不发生路由跳转，避免「先滑入空白页、取消后再滑回」的白屏间隔。
  /** 账户密码兜底验证弹窗状态（仅未开启指纹时使用；标题/提示随目标功能切换） */
  const verify = reactive({ visible: false, title: '', hint: '' })
  /** 当前等待中的验证 Promise 决议器（密码弹窗路径用） */
  let verifyResolve = null

  /**
   * 前置身份验证（与「生物识别解锁」设置一致，单一方式不混用）：
   *   已开启指纹 → 拉起系统指纹框，返回是否通过；
   *   未开启指纹 → 打开账户密码兜底弹窗，等待用户验证 / 取消。
   * @param {{ title: string, hint: string }} opts 密码弹窗文案
   * @returns {Promise<boolean>} 是否通过
   */
  async function requireIdentity({ title, hint }) {
    if (biometric.value) {
      return requestBiometric('verify')
    }
    // 密码路径：打开弹窗并等待结果
    verify.title = title
    verify.hint = hint
    verify.visible = true
    return new Promise((resolve) => {
      verifyResolve = resolve
    })
  }

  /** 密码弹窗验证通过 */
  function onIdentityVerified() {
    verify.visible = false
    verifyResolve?.(true)
    verifyResolve = null
  }

  /** 密码弹窗显隐变更：被关闭（取消 / ESC / 遮罩）即视为未通过 */
  function onIdentityVisibleChange(val) {
    verify.visible = val
    if (!val && verifyResolve) {
      verifyResolve(false)
      verifyResolve = null
    }
  }

  /** 进入修改账户密码页（验证通过后跳转） */
  async function openChangePassword() {
    const ok = await requireIdentity({
      title: '验证身份以修改账户密码',
      hint: '修改后请牢记新密码，旧密码将立即失效。'
    })
    if (ok) router.push({ name: 'ChangeMasterPassword' })
  }

  /** 进入「重新生成恢复码」页（验证身份通过后跳转，旧恢复码将失效） */
  async function openRegenerateRecovery() {
    const ok = await requireIdentity({
      title: '验证身份以重新生成恢复码',
      hint: '生成新恢复码后，旧恢复码将立即失效。'
    })
    if (ok) router.push({ name: 'RegenerateRecovery' })
  }

  /** 进入「数据待恢复」再入口页（输入恢复码恢复 / 无恢复码则放弃旧数据重建） */
  function openRecoverData() {
    router.push({ name: 'RecoverData' })
  }

  /** 进入回收站页 */
  function openTrash() {
    router.push({ name: 'Trash' })
  }

  /** 进入分类管理页 */
  function openCategories() {
    router.push({ name: 'CategoryManage' })
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
    // 云账户卡片状态
    cloudLoggedIn,
    cloudEmail,
    // 数据待恢复态（重置后跳过恢复）：供设置页常驻「数据待恢复」入口显隐
    pendingRecovery,
    // 方法
    toggleSwitch,
    toggleBiometric,
    setAutoLock,
    placeholder,
    openChangePassword,
    openRegenerateRecovery,
    openRecoverData,
    openTrash,
    openCategories,
    // 云端恢复（模块 2 GET /backup）：恢复进行中标志 + 触发入口
    restoringFromCloud,
    restoreFromCloud,
    // 云端备份删除（模块 2 DELETE /backup）：删除进行中标志 + 触发入口（视图二次确认后调用）
    deletingBackup,
    deleteCloudBackup,
    logout,
    // 前置身份验证（账户密码兜底弹窗）状态与回调
    verify,
    onIdentityVerified,
    onIdentityVisibleChange
  }
}
