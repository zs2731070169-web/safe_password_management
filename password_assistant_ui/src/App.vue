<script setup>
/**
 * 应用根组件
 * 整个 App 为移动端风格，外层用一个居中的“手机画布”容器承载路由视图。
 * 外层路由在「主导航外壳 ↔ 全屏页 / 详情」之间默认淡入淡出；进出「新增 / 编辑密码」
 * 表单页改为移动端模态卡片式滑动（自底部滑入 / 向下滑出），过渡 name 与 mode 由路由守卫
 * 按方向写入 outerTransition，见 router/transition.js。Tab 页间横向滑动在 MainTabLayout 内。
 */
import { outerTransition } from '@/router/transition'
import { useAutoLock } from '@/composables/useAutoLock'
import { useTheme } from '@/composables/useTheme'
import BiometricPrompt from '@/components/BiometricPrompt.vue'

// 全局主题：依据「设置 · 深色模式」整屏换肤（切换 html.theme-dark + 状态栏配色），挂载一次即可
useTheme()
// 全局自动锁定：依据「设置 · 自动锁定」时长做定时 / 熄屏锁定，挂载一次即可
useAutoLock()
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__canvas">
      <router-view v-slot="{ Component }">
        <transition :name="outerTransition.name" :mode="outerTransition.mode">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>

    <!-- 全局指纹提示框（录入 / 验证），由 useBiometricPrompt 单例驱动 -->
    <BiometricPrompt />
  </div>
</template>

<style lang="scss" scoped>
.app-shell {
  // 在桌面端将移动端画布水平居中，模拟手机预览
  display: flex;
  justify-content: center;
  align-items: stretch;
  min-height: 100dvh;
  background-color: $color-bg-page;

  &__canvas {
    position: relative;
    width: 100%;
    min-height: 100dvh;
    // 横向安全区（刘海屏横屏时避让）
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
    background-color: $color-bg-page;
    overflow: hidden;
  }
}

// 真机（窄屏）：画布满屏自适应，宽度随设备伸缩（320 → 480）。
// 大屏（平板 / 桌面）：限制为移动端设计宽度并居中，呈现手机预览。
@media (min-width: 480px) {
  .app-shell__canvas {
    max-width: $layout-canvas-max-width; // 390px
    box-shadow:
      0 0 0 1px rgba($shadow-ink, 0.06),
      0 24px 48px -12px rgba($shadow-ink, 0.18);
  }
}
</style>

<!--
  外层路由过渡需为「全局」：过渡 class 加在被路由组件的根节点上，写在 scoped 内会被页面根
  以更高优先级盖掉。卡片式滑动须让进出两页绝对叠放，故 position 用 !important 压过页面根
  （如 MainTabLayout 的 .tab-layout{position:relative}）。Tab 间横向滑动样式在 MainTabLayout 内。
-->
<style lang="scss">
// 外层页面切换：淡入淡出（配合 mode="out-in" 顺序进出）
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// 移动端模态卡片式：进出两页同时存在并绝对叠放，画布全程被覆盖，无淡入淡出留白。
.sheet-up-enter-active,
.sheet-up-leave-active,
.sheet-down-enter-active,
.sheet-down-leave-active {
  position: absolute !important;
  inset: 0;
}

// 打开（sheet-up）：新页自底部滑入并置顶；旧页静止垫底（不动，仅作背景）
.sheet-up-enter-active {
  z-index: 2;
  box-shadow: 0 -8px 32px -8px rgba($shadow-ink, 0.22);
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.sheet-up-leave-active {
  z-index: 1;
}
.sheet-up-enter-from {
  transform: translateY(100%);
}

// 关闭（sheet-down）：旧页向下滑出并置顶；新页静止垫底（露出）
.sheet-down-leave-active {
  z-index: 2;
  box-shadow: 0 -8px 32px -8px rgba($shadow-ink, 0.22);
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.sheet-down-enter-active {
  z-index: 1;
}
.sheet-down-leave-to {
  transform: translateY(100%);
}
</style>
