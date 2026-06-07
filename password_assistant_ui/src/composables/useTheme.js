import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

/**
 * 全局主题（深色 / 浅色）
 *
 * 在应用根组件（App.vue）挂载一次，依据「设置 · 深色模式」开关
 * （`settings.darkMode`）整屏换肤：
 *  - 给 <html> 切换 `theme-dark` 类 —— index.scss 内 `html.theme-dark`
 *    覆盖结构性 Token 的 CSS 变量（背景 / 文字 / 边框），实现运行时换肤；
 *  - 同步 `<meta name="theme-color">` 的 content（移动端状态栏 / 地址栏配色跟随）；
 *  - 同步 documentElement 的 color-scheme（让表单控件 / 滚动条等系统 UI 跟随）。
 *
 * 防闪烁：index.html 的内联脚本已在挂载前按 localStorage 先行加好 `theme-dark`，
 * 本 composable 只负责后续随开关响应式同步，二者用同一判定，刷新无白屏闪烁。
 *
 * 设计 Token 是硬约束：换肤仅靠覆盖 CSS 变量完成，业务组件无需感知主题。
 */

/** 深 / 浅模式下状态栏（meta theme-color）配色，与 index.scss 的 --color-bg-page 对齐 */
const THEME_COLOR = {
  dark: '#0f1218',
  light: '#f9f9ff'
}

export function useTheme() {
  const settings = useSettingsStore()
  const { darkMode } = storeToRefs(settings)

  /**
   * 应用主题到 <html> 与 meta。
   * @param {boolean} dark 是否深色
   */
  function applyTheme(dark) {
    const root = document.documentElement
    root.classList.toggle('theme-dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'

    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light)
  }

  // immediate：首帧即对齐当前设置（与 index.html 防闪烁脚本判定一致，幂等无副作用）
  watch(darkMode, applyTheme, { immediate: true })
}
