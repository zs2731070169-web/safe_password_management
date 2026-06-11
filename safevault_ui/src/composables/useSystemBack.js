import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { addBackButtonListener, exitApp } from '@/services/appBack'

/**
 * 全局系统返回接管
 *
 * 在应用根组件（App.vue）挂载一次。接管 Android 系统返回（曲面屏右侧侧滑 / 全面屏边缘内滑 /
 * 导航栏返回键，均经 @capacitor/app 的 backButton 事件抵达），按当前路由决定：
 *  - 当前在右侧弹出页 / 任意子页（详情 / 新增 / 编辑 / 修改主密码 / 恢复码管理 / 回收站等）：
 *    router.back() 收回当前页——交由 router/index.js 的 afterEach 判定为后退、走 sheet-close
 *    「向右滑回」过渡，效果与点击顶栏返回一致；
 *  - 当前在主导航 Tab 根页（库 / 健康 / 生成 / 设置，以 meta.tab 标记）：视为应用根，退出 App，
 *    不再沿历史栈回退到解锁 / 流程页。
 *
 * 这样曲面屏「侧边左滑」即可逐层收回弹窗，而非一次性退出整个应用。
 * 浏览器环境本 composable 不挂监听（系统返回 = popstate，Vue Router 自理）。
 */
export function useSystemBack() {
  const router = useRouter()
  /** 原生监听注销函数 */
  let removeListener = null

  /**
   * 系统返回处理。
   * @param {boolean} canGoBack WebView 历史是否可后退
   */
  function handleBack(canGoBack) {
    const current = router.currentRoute.value
    // 主导航 Tab 根页（meta.tab）视为应用根：到此返回即退出 App
    const isTabRoot = Boolean(current.meta?.tab)
    if (canGoBack && !isTabRoot) {
      router.back() // 收回当前弹窗 / 子页，走 sheet-close 向右滑回动画
    } else {
      exitApp() // 已在根页或无更多历史：退出应用
    }
  }

  onMounted(async () => {
    removeListener = await addBackButtonListener(handleBack)
  })

  onBeforeUnmount(() => {
    removeListener?.()
    removeListener = null
  })
}
