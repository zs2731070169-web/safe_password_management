import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * useSoftKeyboard —— 侦测移动端软键盘是否弹出
 *
 * 背景：Android WebView 默认 `adjustResize`，软键盘弹出时整个 WebView 物理变矮，
 * CSS 视口单位（vh/lvh/dvh）随之缩小，固定在底部的操作栏会被「顶」到键盘上方。
 * 纯 CSS 无法规避（视口确实变小了），需在 JS 层感知键盘开合再做页面级处理。
 *
 * 原理：软键盘弹出会显著缩小可视视口高度（`visualViewport.height`，
 * 浏览器与 adjustResize WebView 皆然）。以「曾见过的最大可视高度」为基线，
 * 当前高度比基线矮出阈值即判定键盘打开；恢复到接近基线即判定关闭。
 *
 * @param {number} threshold 判定键盘弹出的高度差阈值（px），默认 120
 * @returns {{ keyboardOpen: import('vue').Ref<boolean> }}
 */
export function useSoftKeyboard(threshold = 120) {
  const keyboardOpen = ref(false)

  // 优先用 visualViewport（最贴合实际可视区）；缺失时退回 window.innerHeight
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  let baseline = 0

  function currentHeight() {
    return vv ? vv.height : window.innerHeight
  }

  function measure() {
    const h = currentHeight()
    // 基线取历史最大值：旋屏 / 工具栏收起等导致变高时同步抬升基线
    if (h > baseline) baseline = h
    keyboardOpen.value = baseline - h > threshold
  }

  onMounted(() => {
    baseline = currentHeight()
    if (vv) {
      vv.addEventListener('resize', measure)
    } else {
      window.addEventListener('resize', measure)
    }
  })

  onBeforeUnmount(() => {
    if (vv) {
      vv.removeEventListener('resize', measure)
    } else {
      window.removeEventListener('resize', measure)
    }
  })

  return { keyboardOpen }
}
