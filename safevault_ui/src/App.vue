<script setup>
/**
 * 应用根组件
 * 整个 App 为移动端风格，外层用一个居中的“手机画布”容器承载路由视图。
 * 外层路由在「主导航外壳 ↔ 全屏页」之间默认淡入淡出；右侧弹出页（详情 / 新增 / 编辑 /
 * 修改主密码 / 恢复码管理 / 回收站）由点击进入时自右侧滑入（sheet-right），退出时向右滑回
 * （sheet-close，呼应「在屏幕上向左滑动、页面反向向右收回」手势，见 composables/useSheetDismiss）。
 * 过渡 name 与 mode 由路由守卫按方向写入 outerTransition，见 router/transition.js。
 * Tab 页间横向滑动在 MainTabLayout 内。
 */
import { outerTransition } from '@/router/transition'
import { useAutoLock } from '@/composables/useAutoLock'
import { useSystemBack } from '@/composables/useSystemBack'
import { useCloudBackup } from '@/composables/useCloudBackup'
import { useCloudHydrate } from '@/composables/useCloudHydrate'
import { useLocalPersist } from '@/composables/useLocalPersist'
import BiometricPrompt from '@/components/BiometricPrompt.vue'

// 全局自动锁定：依据「设置 · 自动锁定」时长做定时 / 熄屏锁定，挂载一次即可
useAutoLock()
// 全局系统返回接管：曲面屏侧滑 / 返回键逐层收回弹窗页，而非一次性退出 App，挂载一次即可
useSystemBack()
// 全局云备份监听（模块 2 PUT /backup）：库变更 → 防抖 → 加密上传（仅开启云备份且已登录时），挂载一次即可
useCloudBackup()
// 全局云端水合（模块 2 GET /backup）：登录后下载解密云端整库覆盖本地（下载优先，仅开启云备份时），挂载一次即可
useCloudHydrate()
// 全局本地加密持久化：库变更 → 防抖 → 加密落盘 localStorage；登录后解密秒恢复（独立于云备份开关），挂载一次即可
useLocalPersist()
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

// 移动端弹出式：进出两页同时存在并绝对叠放，画布全程被覆盖，无淡入淡出留白。
.sheet-right-enter-active,
.sheet-right-leave-active,
.sheet-close-enter-active,
.sheet-close-leave-active {
  position: absolute !important;
  inset: 0;
}

// 打开（sheet-right）：新页自右侧滑入并置顶；旧页静止垫底（不动，仅作背景）
.sheet-right-enter-active {
  z-index: 2;
  box-shadow: -8px 0 32px -8px rgba($shadow-ink, 0.22);
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.sheet-right-leave-active {
  z-index: 1;
}
.sheet-right-enter-from {
  transform: translateX(100%);
}

// 关闭（sheet-close）：旧页向右滑回并置顶（退回它进来的右侧）；新页静止垫底（自左侧露出）
// 与「在屏幕上向左滑动、页面反向向右收回」手势同向：手势 / 返回键退出均向右滑出。
.sheet-close-leave-active {
  z-index: 2;
  box-shadow: -8px 0 32px -8px rgba($shadow-ink, 0.22);
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.sheet-close-enter-active {
  z-index: 1;
}
.sheet-close-leave-to {
  transform: translateX(100%);
}
</style>
