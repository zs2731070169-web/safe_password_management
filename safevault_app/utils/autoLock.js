import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { useSettingsStore } from '@/stores/settings'

/**
 * 全局自动锁定单例 —— uni-app 版
 *
 * 依据「设置 · 自动锁定」时长（`settings.autoLockSeconds`，秒）驱动锁定，语义为
 * **「距用户最后一次操作满 N 秒即锁」**：
 *   - 闲置锁定：前台无操作累计达到时长 → 锁定并跳回解锁页；用户每次操作都会重置计时，
 *     故持续操作期间永不锁，停手后才真正倒数（满足「操作中不锁、闲置才锁」）。
 *   - 熄屏锁定：应用进入后台 / 熄屏开始记时，回到前台时若停留已超阈值则立即锁定。
 *   - 时长为 0（永不锁定）则不启用。
 *
 * 【为何做成单例（而非 composable）】
 *   uni-app 的 App.vue 无视图、`onMounted` 不触发，原 `composables/useAutoLock.js` 因此从未生效。
 *   改为模块级单例：状态挂在模块作用域，由 App.vue 的 onLaunch/onShow/onHide 应用生命周期驱动，
 *   并对外暴露 `notifyActivity()` 作为「用户活动」的统一入口，供全局 mixin / 导航工具 / 页面触摸调用。
 *
 * 【跨端活动信号】
 *   - H5：本模块 setup 时直接监听 window DOM 活动事件（mousemove/touch/key 等）→ notifyActivity。
 *   - App：逻辑层无全局 DOM 事件，活动信号由外部喂入——页面 onShow/onPageScroll（main.js 全局 mixin）、
 *     导航跳转（utils/navigation.js）、主停留页根 view 的 @touchstartcapture/@touchmovecapture。
 *   两端最终都汇聚到同一个 notifyActivity()。
 */

/** 高频活动事件的节流间隔（毫秒）——相对 30s+ 的最小阈值，误差可忽略，仅用于削峰避免频繁 clear/set */
const RESET_THROTTLE = 1000

// #ifdef H5
// 视为「用户活动」的 DOM 事件（仅 H5）；被动监听，避免影响滚动 / 触摸性能
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart']
// #endif

/** 前台空闲计时器句柄 */
let idleTimer = null
/** 应用进入后台的时间戳（0 表示当前在前台） */
let hiddenAt = 0
/** 上次刷新计时的时间戳，用于节流高频活动事件 */
let lastReset = 0
/** 是否已 setup（防重复注册 watch / 监听） */
let initialized = false

/** 当前自动锁定时长（秒，0 = 永不锁定） */
function lockSeconds() {
  try {
    return useSettingsStore().autoLockSeconds || 0
  } catch {
    return 0
  }
}

/** 是否已登录解锁（未登录不计时） */
function isUnlocked() {
  try {
    return useCloudAccountStore().loggedIn
  } catch {
    return false
  }
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

/** 执行锁定并清栈回解锁页 */
function doLock() {
  clearIdleTimer()
  if (!isUnlocked()) return
  try {
    useCloudAccountStore().lock()
  } catch (e) {
    console.error('[autoLock] lock 失败：', e)
  }
  // reLaunch 清空历史栈回解锁页（unlock 非受保护页，不被守卫误伤）
  uni.reLaunch({ url: '/pages/unlock/index' })
}

/** 重新开始前台空闲计时（仅在已登录、时长 > 0 时） */
function resetIdleTimer() {
  clearIdleTimer()
  const seconds = lockSeconds()
  if (!isUnlocked() || seconds <= 0) return
  lastReset = Date.now()
  idleTimer = setTimeout(doLock, seconds * 1000)
}

/**
 * 用户活动通知 —— 重置空闲计时（节流）。
 * 这是「操作中不锁」的核心：任何用户操作信号都经此重置计时，持续操作则计时永不到点。
 * 节流窗口（1s）远小于最小阈值（30s），对锁定时机无可感知影响。
 */
export function notifyActivity() {
  if (!isUnlocked() || lockSeconds() <= 0) return
  if (Date.now() - lastReset < RESET_THROTTLE) return
  resetIdleTimer()
}

/** 进入后台 / 熄屏：停止前台计时（后台定时不可靠），记录时刻 */
export function onAppBackground() {
  if (!isUnlocked()) return
  clearIdleTimer()
  hiddenAt = Date.now()
}

/** 回到前台：后台停留超阈值则立即锁定，否则重启空闲计时 */
export function onAppForeground() {
  if (!isUnlocked()) return
  const seconds = lockSeconds()
  if (seconds > 0 && hiddenAt && Date.now() - hiddenAt >= seconds * 1000) {
    doLock()
  } else {
    resetIdleTimer()
  }
  hiddenAt = 0
}

/**
 * 初始化自动锁定：在 App.vue 的 onLaunch 调用一次。
 * 注册「登录态 / 时长变化即时重置」watch；H5 端额外注册 window 活动事件。
 */
export function setupAutoLock() {
  if (initialized) return
  initialized = true

  try {
    const { loggedIn } = storeToRefs(useCloudAccountStore())
    const { autoLockSeconds } = storeToRefs(useSettingsStore())
    // 登录成功后启动空闲计时，锁定后停止，用户在设置页改时长即时生效
    watch([loggedIn, autoLockSeconds], () => resetIdleTimer())
  } catch (e) {
    console.error('[autoLock] 监听注册失败：', e)
  }

  // #ifdef H5
  // H5 端有全局 DOM：直接监听细粒度用户活动，节流重置计时
  ACTIVITY_EVENTS.forEach((evt) =>
    window.addEventListener(
      evt,
      () => {
        if (document.visibilityState !== 'visible') return
        notifyActivity()
      },
      { passive: true }
    )
  )
  // #endif

  resetIdleTimer()
}
