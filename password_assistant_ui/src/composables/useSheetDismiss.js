import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'

// 真机标志：原生环境下系统返回手势（曲面屏侧滑 / 全面屏边缘内滑 / 返回键）由 useSystemBack
// 统一接管收回弹窗，此处的 JS 边缘手势改为禁用，避免二者「双触发」连退两层。
// 浏览器无系统返回手势，本 composable 仍提供边缘左滑收回，便于 `npm run dev` 预览。
const IS_NATIVE = Capacitor?.isNativePlatform?.() ?? false

/**
 * useSheetDismiss —— 右侧弹出式页面的「左滑反向收回」手势编排
 *
 * 配合 App.vue 的 sheet-right 进入 / sheet-close 退出过渡：这些页面由点击自右侧滑入，
 * 关闭则在屏幕上**向左滑动**触发——但页面朝**反方向（向右）**收回滑出、退回它进来的右侧，
 * 露出下层页面。
 *
 * 注意：真机（Capacitor 原生）已由 useSystemBack 接管系统返回手势（曲面屏右侧侧滑 / 返回键）
 * 来收回弹窗，故本 JS 边缘手势在原生环境禁用（见 IS_NATIVE 守卫），仅浏览器预览时生效。
 *
 * 关键点：
 *   - 右侧边缘起手：仅当触摸起点落在页面**右边缘 EDGE_WIDTH 内**才进入返回跟踪，贴合
 *     曲面屏「右侧侧边往左滑返回」的系统手势；内容区左滑一律交还原生行为，避免误触；
 *   - 方向判定：越过阈值后须为「向左 + 横向为主」才跟手，否则交还原生滚动 / 纵向手势；
 *   - 跟手：拖拽过程中页面朝反方向（向右）随手指位移 translateX（仅向右），无过渡；
 *   - 释放判定：手指左移距离超过宽度阈值或左滑速度够快即关闭——给页面补一段向右滑出场
 *     动画后调用 onDismiss（默认 router.back，交由 sheet-close 过渡露出下层页面），
 *     否则回弹归位；
 *   - 空闲态不施加任何内联 transform，保证进入时的 sheet-right 过渡不被覆盖。
 *
 * 用法（在右侧弹出页根组件）：
 *   const { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd } = useSheetDismiss()
 *   <div class="xxx-page" ref="sheetRoot" :style="sheetStyle"
 *        @touchstart.passive="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
 *
 * @param {object} [options]
 * @param {() => void} [options.onDismiss] 关闭回调，默认 router.back()
 */
export function useSheetDismiss(options = {}) {
  const router = useRouter()
  const onDismiss = options.onDismiss || (() => router.back())

  /** 绑定到页面根元素（用于读取页面宽度） */
  const sheetRoot = ref(null)
  /** 当前页面位移（px，反向收回故向右为正） */
  const offsetX = ref(0)
  /** 阶段：idle 空闲 | dragging 跟手 | returning 回弹 | closing 关闭中 */
  const phase = ref('idle')

  // —— 单次手势的临时状态 ——
  let startX = 0
  let startY = 0
  let startTime = 0
  let width = 0 // 起手时页面宽度（用于阈值与回弹基准）
  let tracking = false // 是否处于一次有效触摸跟踪中
  let decided = false // 是否已判定本次手势方向

  // 右侧边缘起手热区宽度（px）：触摸起点须落在距页面右边缘此距离内才视为返回手势起手，
  // 贴合曲面屏系统侧滑返回的边缘触发区，避免内容区左滑误触
  const EDGE_WIDTH = 24
  // 判定为返回手势的最小位移（px）
  const START_THRESHOLD = 10
  // 释放时左移超过「页面宽度 × 此比例」即关闭
  const CLOSE_RATIO = 0.35
  // 或左滑速度超过此值即关闭（px/ms）
  const CLOSE_VELOCITY = 0.5

  /** 根元素内联样式：仅在拖拽 / 回弹 / 关闭时施加 transform，空闲态留给路由过渡 */
  const sheetStyle = computed(() => {
    if (phase.value === 'dragging') {
      return { transform: `translateX(${offsetX.value}px)`, transition: 'none' }
    }
    if (phase.value === 'returning') {
      return { transform: 'translateX(0)', transition: 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)' }
    }
    if (phase.value === 'closing') {
      return { transform: 'translateX(100%)', transition: 'transform 0.28s ease-out' }
    }
    return {}
  })

  function onTouchStart(e) {
    // 真机交由系统返回手势接管（见 useSystemBack），不启用 JS 边缘手势，避免双触发连退两层
    if (IS_NATIVE) return
    if (phase.value === 'closing') return
    // 多指（缩放等）不处理
    if (e.touches.length !== 1) {
      tracking = false
      return
    }
    const t = e.touches[0]
    const rect = sheetRoot.value?.getBoundingClientRect()
    // 仅右侧边缘起手才跟踪：起点距页面右边缘超过 EDGE_WIDTH 直接放行，交还原生行为
    const rightEdge = rect ? rect.right : (window.innerWidth || 0)
    if (rightEdge - t.clientX > EDGE_WIDTH) {
      tracking = false
      return
    }
    startX = t.clientX
    startY = t.clientY
    startTime = e.timeStamp
    width = rect?.width || window.innerWidth || 1
    tracking = true
    decided = false
  }

  function onTouchMove(e) {
    if (!tracking) return
    const t = e.touches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY

    // 首次越过阈值时判定方向：向左 + 横向为主才进入返回手势
    if (!decided) {
      if (Math.abs(dx) < START_THRESHOLD && Math.abs(dy) < START_THRESHOLD) return
      decided = true
      const leftHorizontal = dx < 0 && Math.abs(dx) > Math.abs(dy)
      if (leftHorizontal) {
        phase.value = 'dragging'
      } else {
        // 向右 / 纵向：交还原生行为（如内容滚动）
        tracking = false
        return
      }
    }

    if (phase.value === 'dragging') {
      // 阻止原生行为，页面朝反方向跟手（手指左移、页面向右收回，限制在 [0, width]）
      e.preventDefault()
      offsetX.value = Math.max(0, Math.min(width, -dx))
    }
  }

  function onTouchEnd(e) {
    if (!tracking || phase.value !== 'dragging') {
      tracking = false
      return
    }
    tracking = false
    const dt = Math.max(1, e.timeStamp - startTime)
    const distance = Math.abs(offsetX.value)
    const velocity = distance / dt

    if (distance > width * CLOSE_RATIO || velocity > CLOSE_VELOCITY) {
      // 关闭：先把页面补滑出右侧，再于下一帧导航（确保关闭动画已开始绘制）
      phase.value = 'closing'
      requestAnimationFrame(() => onDismiss())
    } else {
      // 未达阈值：回弹归位
      phase.value = 'returning'
      offsetX.value = 0
      window.setTimeout(() => {
        if (phase.value === 'returning') phase.value = 'idle'
      }, 260)
    }
  }

  return { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd }
}
