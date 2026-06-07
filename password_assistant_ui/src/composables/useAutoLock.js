import { watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

/**
 * 全局自动锁定
 *
 * 在应用根组件（App.vue）挂载一次，依据「设置 · 自动锁定」时长
 * （`settings.autoLockSeconds`，秒）驱动两类锁定触发：
 *  - 定时锁定：前台可见状态下，用户无操作累计达到时长 → 锁定并跳回解锁页；
 *  - 熄屏锁定：页面进入后台 / 熄屏（`visibilitychange → hidden`，Web 端对
 *    「切后台 / 锁屏」的等价信号）开始计时，回到前台时若停留已超阈值则立即锁定。
 *  - 时长为 0（永不锁定）则不启用。
 *
 * 仅在已解锁态生效；时长变更 / 解锁态变化均即时重置计时。
 * 真实接入时此编排无需改动——锁定动作仍走 `auth.lock()`。
 */
export function useAutoLock() {
  const router = useRouter()
  const auth = useAuthStore()
  const settings = useSettingsStore()
  const { isUnlocked } = storeToRefs(auth)
  const { autoLockSeconds } = storeToRefs(settings)

  /** 前台空闲计时器句柄 */
  let idleTimer = null
  /** 页面进入后台的时间戳（0 表示当前在前台） */
  let hiddenAt = 0
  /** 上次刷新计时的时间戳，用于节流高频活动事件（如 mousemove） */
  let lastReset = 0

  // 视为「用户活动」的事件；被动监听，避免影响滚动 / 触摸性能
  const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart']
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
    // 当前若停留在受保护页，beforeEach 不会被动触发，需显式跳转
    if (router.currentRoute.value.name !== 'Unlock') {
      router.replace({ name: 'Unlock' })
    }
  }

  /** 重新开始前台空闲计时（仅在已解锁、时长 > 0、页面可见时） */
  function resetIdleTimer() {
    clearIdleTimer()
    const seconds = autoLockSeconds.value
    if (!isUnlocked.value || seconds <= 0) return
    if (document.visibilityState !== 'visible') return
    lastReset = Date.now()
    idleTimer = setTimeout(doLock, seconds * 1000)
  }

  /** 用户活动：节流刷新空闲计时 */
  function onActivity() {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastReset < RESET_THROTTLE) return
    resetIdleTimer()
  }

  /** 前后台切换：熄屏锁定的核心判断 */
  function onVisibilityChange() {
    if (!isUnlocked.value) return
    const seconds = autoLockSeconds.value
    if (document.visibilityState === 'hidden') {
      // 进入后台 / 熄屏：停止前台计时（后台 setTimeout 不可靠），记录时刻
      clearIdleTimer()
      hiddenAt = Date.now()
      return
    }
    // 回到前台：后台停留超阈值则立即锁定，否则重启空闲计时
    if (seconds > 0 && hiddenAt && Date.now() - hiddenAt >= seconds * 1000) {
      doLock()
    } else {
      resetIdleTimer()
    }
    hiddenAt = 0
  }

  onMounted(() => {
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, onActivity, { passive: true })
    )
    document.addEventListener('visibilitychange', onVisibilityChange)
    resetIdleTimer()
  })

  onBeforeUnmount(() => {
    ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity))
    document.removeEventListener('visibilitychange', onVisibilityChange)
    clearIdleTimer()
  })

  // 解锁后启动、锁定后停止；用户在设置页改时长即时生效
  watch([isUnlocked, autoLockSeconds], () => resetIdleTimer())
}
