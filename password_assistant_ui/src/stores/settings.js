import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useVaultStore } from '@/stores/vault'

/**
 * 设置 Store
 *
 * 持有设置页的全部偏好状态（安全 / 显示开关 + 自动锁定时长）与回收站数量徽标。
 * 当前为纯前端 mock：
 *   - 开关 / 自动锁定时长仅本地持久化到 localStorage，无后端；
 *   - 深色模式开关真正生效：useTheme（App.vue 挂载）监听 darkMode 整屏换肤；
 *   - 回收站数量由 vault.trashedEntries 实时派生（删除 / 恢复 / 清空后徽标自动刷新）。
 * 真实接入时仅替换文件末尾的 mock 实现（持久化改写后端），视图与 composable 不动。
 *
 * 还原 DRD 4.12 设置页：安全 / 数据 / 显示 / 关于 四组。
 */

/** localStorage 持久化 key（统一前缀，便于排查 / 清理） */
const STORAGE_KEY = 'safevault.settings'

/**
 * 自动锁定时长可选项（DRD 4.12「永不锁定 / 30s / 60s / 2min / 5min」）。
 * value 为秒数，0 表示「永不锁定」（不自动锁定）；label 为列表 / 弹窗展示文案。
 */
export const AUTO_LOCK_OPTIONS = [
  { value: 0, label: '永不锁定' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '60 秒' },
  { value: 120, label: '2 分钟' },
  { value: 300, label: '5 分钟' }
]

/** 默认偏好（首次进入 / 无本地缓存时使用） */
const DEFAULT_PREFS = {
  /** 生物识别解锁开关（同时表示「是否已录入指纹」；首次进入为未录入 false） */
  biometric: false,
  /** 自动锁定时长（秒），见 AUTO_LOCK_OPTIONS */
  autoLockSeconds: 60,
  /** 深色模式开关（由 useTheme 监听并整屏换肤） */
  darkMode: false,
  /** 账号脱敏显示开关 */
  maskAccount: true
}

export const useSettingsStore = defineStore('settings', () => {
  // ---------------------------------------------------------------
  // state（从 localStorage 恢复，缺省回落默认值）
  // ---------------------------------------------------------------
  const restored = loadPrefs()

  /** 生物识别解锁 */
  const biometric = ref(restored.biometric)
  /** 自动锁定时长（秒） */
  const autoLockSeconds = ref(restored.autoLockSeconds)
  /** 深色模式（useTheme 监听此值整屏换肤） */
  const darkMode = ref(restored.darkMode)
  /** 账号脱敏显示 */
  const maskAccount = ref(restored.maskAccount)

  /** 回收站待清理条目数：从 vault 回收站实时派生，用于设置页行尾徽标 */
  const trashCount = computed(() => useVaultStore().trashedEntries.length)

  // ---------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------
  /**
   * 设置自动锁定时长（仅接受合法选项值，非法值忽略）
   * @param {number} seconds 目标秒数（须在 AUTO_LOCK_OPTIONS 内）
   */
  function setAutoLockSeconds(seconds) {
    const exists = AUTO_LOCK_OPTIONS.some((opt) => opt.value === seconds)
    if (exists) autoLockSeconds.value = seconds
  }

  /**
   * 显式设置生物识别解锁开关（= 是否已录入指纹）。
   * 由指纹录入 / 验证流程在通过后调用，不走 toggle（避免未经验证直接翻转）。
   * @param {boolean} enabled
   */
  function setBiometric(enabled) {
    biometric.value = Boolean(enabled)
  }

  /**
   * 切换某个布尔型开关
   * @param {'biometric'|'darkMode'|'maskAccount'} key 开关键名
   */
  function toggle(key) {
    const map = { biometric, darkMode, maskAccount }
    const target = map[key]
    if (target) target.value = !target.value
  }

  // ---------------------------------------------------------------
  // 持久化：任一偏好变更即写回 localStorage（mock，真实接入改写后端）
  // ---------------------------------------------------------------
  watch(
    [biometric, autoLockSeconds, darkMode, maskAccount],
    () => {
      persistPrefs({
        biometric: biometric.value,
        autoLockSeconds: autoLockSeconds.value,
        darkMode: darkMode.value,
        maskAccount: maskAccount.value
      })
    }
  )

  return {
    // state
    biometric,
    autoLockSeconds,
    darkMode,
    maskAccount,
    trashCount,
    // actions
    setAutoLockSeconds,
    setBiometric,
    toggle
  }
})

// ===============================================================
// 以下为 mock / 本地持久化实现，真实接入时替换即可
// ===============================================================

/**
 * 从 localStorage 读取偏好，缺省 / 解析失败回落默认值。
 * @returns {typeof DEFAULT_PREFS}
 */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw)
    // 与默认值合并，容忍新增字段 / 旧缓存缺字段
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/**
 * 将偏好写回 localStorage（容错：隐私模式 / 配额异常时静默失败）。
 * @param {typeof DEFAULT_PREFS} prefs 待持久化的偏好快照
 */
function persistPrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）时静默降级，不阻断交互
  }
}
