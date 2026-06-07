/**
 * useSwipeNav —— 主导航 Tab 页之间的「触摸滑动翻页」
 *
 * 绑定在 Tab 页根元素上：水平滑动超过阈值即切到相邻 Tab（复用各页的 handleTabChange）。
 * 与导航条点击互补 —— 既能点也能滑，滑动让页面切换更贴近移动端习惯。
 *
 * 冲突规避：
 *   - 起点落在带 [data-swipe-ignore] 的横向滚动区（如分类胶囊）时不参与翻页；
 *   - 全程不 preventDefault，纵向滚动 / 内部横向滚动均正常放行，仅在 touchend
 *     依据累计位移判定是否翻页（水平位移须明显大于垂直，避免误触纵向滚动）。
 */
import { unref } from 'vue'
import { TABS, tabIndexOf } from '@/constants/tabs'

/** 触发翻页的最小水平位移（px） */
const THRESHOLD = 60
/** 水平位移须达到垂直位移的此倍数，方判定为横向滑动 */
const RATIO = 1.4
/** 滑动最长耗时（ms），超时视为缓慢拖拽，不翻页 */
const MAX_DURATION = 600

/**
 * @param {string | import('vue').Ref<string>} activeKey 当前激活的 Tab key；
 *   支持响应式 ref/computed —— 常驻外壳里 activeKey 会随路由变化，故在 touchend
 *   时实时取值（用 unref 兼容普通 string）
 * @param {(key: string) => void} requestTab 请求切换到目标 Tab（外壳传入其 onTabChange）
 * @returns {{ onTouchStart: (e: TouchEvent) => void, onTouchEnd: (e: TouchEvent) => void }}
 */
export function useSwipeNav(activeKey, requestTab) {
  let startX = 0
  let startY = 0
  let startTime = 0
  let tracking = false

  function onTouchStart(e) {
    // 仅跟踪单指；多指（缩放等）忽略
    if (e.touches.length !== 1) {
      tracking = false
      return
    }
    // 起点落在横向滚动区则交由其自行处理，本翻页不介入
    if (e.target.closest?.('[data-swipe-ignore]')) {
      tracking = false
      return
    }
    const touch = e.touches[0]
    startX = touch.clientX
    startY = touch.clientY
    startTime = Date.now()
    tracking = true
  }

  function onTouchEnd(e) {
    if (!tracking) return
    tracking = false

    const touch = e.changedTouches[0]
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY

    if (Date.now() - startTime > MAX_DURATION) return
    if (Math.abs(dx) < THRESHOLD) return
    if (Math.abs(dx) < Math.abs(dy) * RATIO) return // 纵向为主，放行滚动

    const index = tabIndexOf(unref(activeKey))
    // 向左滑（dx < 0）→ 下一个 Tab；向右滑 → 上一个 Tab
    const target = dx < 0 ? TABS[index + 1] : TABS[index - 1]
    if (target) requestTab(target.key)
  }

  return { onTouchStart, onTouchEnd }
}
