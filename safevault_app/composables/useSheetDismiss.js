import { ref, computed } from 'vue'
import { navBack } from '@/utils/navigation'
import { notifyActivity } from '@/utils/autoLock'

// 边缘左滑收回手势：App 与 H5 两端均启用。
//
// 【为何 App 端也启用（曾一度禁用）】App 端原依赖 uni 原生侧滑返回（popGesture）收回弹窗，
// 但原生侧滑与 SHEET 页的自定义 pop-in 入场动画配合时「第一次侧滑常被吞掉、第二次才识别」，
// 体验割裂。现已在 pages.json 对 SHEET 页显式 popGesture: "none" 关闭原生侧滑，改由本 JS 手势
// 独占收回——第一次左滑即生效、带跟手动画；原生侧滑既已关闭，也不再与本手势双触发连退两层。
// 系统返回键仍走框架内置返回栈（navigateBack 收回），与本手势是不同输入、互不重复。

/**
 * useSheetDismiss —— 右侧弹出式页面的「左滑反向收回」手势编排（uni-app 版）
 *
 * 配合 pages.json 中 SHEET 页的 pop-in/pop-out 过渡：这些页面由 navigateTo 自右侧滑入，
 * 关闭则在屏幕上**向左滑动**触发——页面朝**反方向（向右）**收回滑出、退回它进来的右侧。
 *
 * 注意：App 端 SHEET 页已关原生侧滑（popGesture: none），本 JS 边缘手势在两端均生效、独占收回；
 * 系统返回键仍由框架内置返回栈处理，与本手势互不重复。
 *
 * —— 自源工程（vue-router + Capacitor）迁移而来 ——
 *   - onDismiss 默认 router.back() → navBack()（uni 页面栈回退，触发 pop-out 右滑回过渡）；
 *   - window.innerWidth → uni.getSystemInfoSync().windowWidth（取屏宽兜底）；
 *   - 触摸事件结构（e.touches[0].clientX / e.timeStamp）两端一致，逻辑原样保留。
 *
 * 用法（在右侧弹出页根组件）：
 *   const { sheetStyle, onTouchStart, onTouchMove, onTouchEnd } = useSheetDismiss()
 *   <view class="xxx-page" :style="sheetStyle"
 *        @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
 *
 * @param {object} [options]
 * @param {() => void} [options.onDismiss] 关闭回调，默认 navBack()
 */
export function useSheetDismiss(options = {}) {
  const onDismiss = options.onDismiss || (() => navBack())

  /** 绑定到页面根元素（保留以兼容旧用法；uni 下宽度改用系统信息，不强依赖 ref） */
  const sheetRoot = ref(null)
  /** 当前页面位移（px，反向收回故向右为正） */
  const offsetX = ref(0)
  /** 阶段：idle 空闲 | dragging 跟手 | returning 回弹 | closing 关闭中 */
  const phase = ref('idle')

  // —— 单次手势的临时状态 ——
  let startX = 0
  let startY = 0
  let startTime = 0
  let width = 0 // 起手时屏幕宽度（用于阈值与回弹基准）
  let tracking = false // 是否处于一次有效触摸跟踪中
  let decided = false // 是否已判定本次手势方向

  // 起手热区：触摸起点须落在「屏幕右侧此比例区域」内（从右算起）才视为返回手势起手。
  // 取右侧 50%（而非旧版极窄的右边缘 24px）：
  //   1) 旧版热区只有 24px 一条，真机上极难一次点中，常致「第一次左滑没反应、第二次才触发」；
  //   2) 手势导航机型最右极窄边缘正是系统返回手势区，起手于此会被系统拦走并向 webview 发
  //      touchcancel，使 JS 手势半途中断——放宽到右半区后，用户可从内容区往左滑、避开系统边缘区，
  //      第一次即可稳定识别。左半区起手仍放行（避免与潜在左侧交互冲突）。
  const START_ZONE_RATIO = 0.5
  // 判定为返回手势的最小位移（px）
  const START_THRESHOLD = 10
  // 释放时左移超过「屏幕宽度 × 此比例」即关闭
  const CLOSE_RATIO = 0.35
  // 或左滑速度超过此值即关闭（px/ms）
  const CLOSE_VELOCITY = 0.5

  /** 取屏幕宽度（uni 通用，App/H5 一致；失败兜底 375） */
  function screenWidth() {
    try {
      return uni.getSystemInfoSync().windowWidth || 375
    } catch {
      return 375
    }
  }

  /** 根元素内联样式：仅在拖拽 / 回弹 / 关闭时施加 transform，空闲态留给页面过渡 */
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
    // 用户在 SHEET 子页内任意触摸都算「操作」，重置自动锁定空闲计时（与下方收回手势判定无关，
    // 故置于最前、无条件触发）。本 composable 被全部 SHEET 子页共用，一处即覆盖详情/新增/编辑/
    // 改密/恢复码/回收站/分类等页的页面内触摸。
    notifyActivity()
    if (phase.value === 'closing') return
    // 清掉上一手势可能残留的卡死状态（如被系统打断未走 touchend 时，phase 停在 dragging、
    // 页面仍带位移）：新手势起手即复位，避免页面卡在半收回处或干扰本次判定。
    if (phase.value !== 'idle') {
      phase.value = 'idle'
      offsetX.value = 0
    }
    if (e.touches.length !== 1) {
      tracking = false
      return
    }
    const t = e.touches[0]
    width = screenWidth()
    // 仅右侧热区起手才跟踪：起点落在屏幕左侧（< 宽度 ×(1−比例)）直接放行
    if (t.clientX < width * (1 - START_ZONE_RATIO)) {
      tracking = false
      return
    }
    startX = t.clientX
    startY = t.clientY
    startTime = e.timeStamp
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
        tracking = false
        return
      }
    }

    if (phase.value === 'dragging') {
      // 页面朝反方向跟手（手指左移、页面向右收回，限制在 [0, width]）
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
      setTimeout(() => onDismiss(), 16)
    } else {
      // 未达阈值：回弹归位
      phase.value = 'returning'
      offsetX.value = 0
      setTimeout(() => {
        if (phase.value === 'returning') phase.value = 'idle'
      }, 260)
    }
  }

  /**
   * 触摸被系统打断（touchcancel）：如手势导航机型在边缘起手被系统返回手势抢走、或来电等。
   * 不做收回判定，直接回弹归位，避免页面卡在半收回的位移处。
   */
  function onTouchCancel() {
    tracking = false
    if (phase.value === 'dragging') {
      phase.value = 'returning'
      offsetX.value = 0
      setTimeout(() => {
        if (phase.value === 'returning') phase.value = 'idle'
      }, 260)
    }
  }

  return { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
