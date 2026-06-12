import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * useSoftKeyboard —— 侦测移动端软键盘是否弹出（uni-app 版）
 *
 * 背景：软键盘弹出时，固定在底部的操作栏需上移避让，纯 CSS 无法可靠规避，需 JS 感知键盘开合。
 *
 * —— 自源工程（window.visualViewport resize 高度差推断）迁移而来 ——
 * uni 提供了语义更直接的 `uni.onKeyboardHeightChange`（App + H5 通用），直接拿到键盘像素高度，
 * 比「可视视口高度差」更准、无需维护基线，故改用之：高度 > 阈值即判定键盘打开。
 *
 * @param {number} threshold 判定键盘弹出的高度阈值（px），默认 80
 * @returns {{ keyboardOpen: import('vue').Ref<boolean>, keyboardHeight: import('vue').Ref<number> }}
 */
export function useSoftKeyboard(threshold = 80) {
  const keyboardOpen = ref(false)
  /** 当前键盘高度（px），供需要精确避让的页面读取 */
  const keyboardHeight = ref(0)

  function onChange(res) {
    const h = res?.height || 0
    keyboardHeight.value = h
    keyboardOpen.value = h > threshold
  }

  onMounted(() => {
    uni.onKeyboardHeightChange(onChange)
  })

  onBeforeUnmount(() => {
    // uni.offKeyboardHeightChange 在部分版本需传同一回调
    uni.offKeyboardHeightChange && uni.offKeyboardHeightChange(onChange)
  })

  return { keyboardOpen, keyboardHeight }
}
