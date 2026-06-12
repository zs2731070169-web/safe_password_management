import { watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { useSettingsStore } from '@/stores/settings'
import { navReplace, currentPath } from '@/utils/navigation'

/**
 * 全局自动锁定 —— uni-app 版
 *
 * 在应用根组件（App.vue）挂载一次，依据「设置 · 自动锁定」时长
 * （`settings.autoLockSeconds`，秒）驱动两类锁定触发：
 *  - 定时锁定：前台可见状态下，用户无操作累计达到时长 → 锁定并跳回解锁页；
 *  - 熄屏锁定：应用进入后台 / 熄屏开始计时，回到前台时若停留已超阈值则立即锁定。
 *  - 时长为 0（永不锁定）则不启用。
 *
 * —— 自源工程（vue-router + DOM visibilitychange / window 活动事件）迁移而来 ——
 * 跨端差异处理：
 *   - 前后台切换：源工程的 `document visibilitychange` 改为 uni 的 `uni.onAppShow / onAppHide`
 *     （App 与 H5 通用，是「切后台 / 锁屏 / 回前台」的标准信号）。
 *   - 前台「用户活动」监听：H5 仍用 window DOM 事件（mousemove/touch 等）节流重置计时；
 *     App 端逻辑层无全局 DOM 事件，降级为「不监听细粒度活动」——前台仅靠空闲定时器到期锁定，
 *     每次回前台（onAppShow）重置。对密码库这一安全降级可接受（宁可偏严，不漏锁）。
 *   - 锁定跳转：navReplace('Unlock')（清当前页入解锁页），跳前用 currentPath 判断避免重复跳。
 *
 * 仅在已解锁态生效；时长变更 / 解锁态变化均即时重置计时。
 */
export function useAutoLock() {
  const auth = useCloudAccountStore()
  const settings = useSettingsStore()
  // 登录态即「已解锁」：未登录不计时，自动锁定触发即登出并回登录页
  const { loggedIn: isUnlocked } = storeToRefs(auth)
  const { autoLockSeconds } = storeToRefs(settings)

  /** 前台空闲计时器句柄 */
  let idleTimer = null
  /** 应用进入后台的时间戳（0 表示当前在前台） */
  let hiddenAt = 0
  /** 上次刷新计时的时间戳，用于节流高频活动事件（如 mousemove，仅 H5） */
  let lastReset = 0
  /** uni 前后台监听注销句柄 */
  let offAppShow = null
  let offAppHide = null

  // #ifdef H5
  // 视为「用户活动」的事件（仅 H5）；被动监听，避免影响滚动 / 触摸性能
  const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart']
  // #endif
  // 高频活动事件的节流间隔（毫秒）——相对 30s+ 的阈值，误差可忽略
  const RESET_THROTTLE = 1000

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  /** 执行锁定并跳回解锁页 */
  function doLock() {
    clearIdleTimer()
    if (!isUnlocked.value) return
    auth.lock()
    // 当前若不在解锁页，显式跳转（清栈入解锁页）
    if (currentPath() !== '/pages/unlock/index') {
      navReplace('Unlock')
    }
  }

  /** 重新开始前台空闲计时（仅在已解锁、时长 > 0 时） */
  function resetIdleTimer() {
    clearIdleTimer()
    const seconds = autoLockSeconds.value
    if (!isUnlocked.value || seconds <= 0) return
    lastReset = Date.now()
    idleTimer = setTimeout(doLock, seconds * 1000)
  }

  // #ifdef H5
  /** 用户活动：节流刷新空闲计时（仅 H5） */
  function onActivity() {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastReset < RESET_THROTTLE) return
    resetIdleTimer()
  }
  // #endif

  /** 进入后台 / 熄屏：停止前台计时（后台定时不可靠），记录时刻 */
  function onAppHide() {
    if (!isUnlocked.value) return
    clearIdleTimer()
    hiddenAt = Date.now()
  }

  /** 回到前台：后台停留超阈值则立即锁定，否则重启空闲计时 */
  function onAppShow() {
    if (!isUnlocked.value) return
    const seconds = autoLockSeconds.value
    if (seconds > 0 && hiddenAt && Date.now() - hiddenAt >= seconds * 1000) {
      doLock()
    } else {
      resetIdleTimer()
    }
    hiddenAt = 0
  }

  onMounted(() => {
    // 前后台切换：uni 通用 API（App + H5）
    uni.onAppShow(onAppShow)
    uni.onAppHide(onAppHide)
    offAppShow = () => uni.offAppShow && uni.offAppShow(onAppShow)
    offAppHide = () => uni.offAppHide && uni.offAppHide(onAppHide)

    // #ifdef H5
    // H5 额外监听细粒度用户活动以更精准地重置空闲计时
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, onActivity, { passive: true })
    )
    // #endif

    resetIdleTimer()
  })

  onBeforeUnmount(() => {
    offAppShow && offAppShow()
    offAppHide && offAppHide()
    // #ifdef H5
    ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity))
    // #endif
    clearIdleTimer()
  })

  // 解锁后启动、锁定后停止；用户在设置页改时长即时生效
  watch([isUnlocked, autoLockSeconds], () => resetIdleTimer())
}
