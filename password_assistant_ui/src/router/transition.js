import { reactive } from 'vue'

/**
 * 内层 Tab 滑动过渡状态
 *
 * 仅承载「主导航 Tab 页之间」横向滑动的方向，由路由守卫（router/index.js 的 afterEach）
 * 按 Tab 前后写入，常驻外壳 MainTabLayout 的内层 <transition> 读取。
 *   name: 'slide-left'（前进，新页自右滑入）| 'slide-right'（后退，新页自左滑入）
 * 外层页面切换（外壳 ↔ 全屏页 / 详情）固定淡入淡出，见 App.vue，与此状态无关。
 */
export const routeTransition = reactive({
  name: 'slide-left'
})

/**
 * 外层页面过渡状态（App.vue 外层 <transition> 读取，由路由守卫 afterEach 写入）
 *
 * 默认「外壳 ↔ 全屏页」走淡入淡出，且 mode='out-in'（旧页先出、新页后进）。
 * 进出「右侧弹出页」（详情 / 新增 / 编辑 / 修改主密码 / 恢复码管理 / 回收站）改为移动端
 * 弹出式滑动，避免淡入淡出中途的留白：
 *   - 打开（进入弹出页）：name='sheet-right'，新页自右侧滑入、盖在静止旧页之上
 *   - 关闭（离开弹出页）：name='sheet-close'，旧页向右滑回（退回进来的右侧）、露出底下静止的新页
 *     （与「在屏幕上向左滑动、页面反向向右收回」手势同向，见 composables/useSheetDismiss）
 * 弹出式两页需同时进出叠放（simultaneous），故此时 mode 置 null 取消 out-in。
 */
export const outerTransition = reactive({
  name: 'fade',
  mode: 'out-in'
})
