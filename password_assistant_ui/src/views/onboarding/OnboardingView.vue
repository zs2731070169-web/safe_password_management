<script setup>
/**
 * OnboardingView —— 新用户开户流程（全屏，单步：创建云账户）
 *
 * 首次启动（未注册云账户）由路由守卫强制进入。统一身份后开户即「创建云账户」：
 * 填邮箱 + 密码 + 邮箱验证码，注册成功即登录并进入密码库（找回密码改走邮箱验证码重置，
 * 不再有恢复码步骤）。视觉沿用解锁页的光晕 + 居中布局语言。
 * 指纹保持默认关闭，开户不触碰，用户日后在设置页自行开启。
 */
import { useRouter } from 'vue-router'

import SetupPasswordStep from './components/SetupPasswordStep.vue'

const router = useRouter()

/** 创建账户完成：register 已置为已登录，直接进入密码库 */
function onAccountCreated() {
  router.replace({ name: 'Vault' })
}
</script>

<template>
  <div class="onboarding-page">
    <!-- 背景氛围光晕（不参与交互） -->
    <div class="onboarding-page__glow onboarding-page__glow--top" aria-hidden="true"></div>
    <div class="onboarding-page__glow onboarding-page__glow--bottom" aria-hidden="true"></div>

    <div class="onboarding-page__main">
      <SetupPasswordStep @done="onAccountCreated" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.onboarding-page {
  position: relative;
  min-height: 100dvh;
  background-color: $color-bg-page;
  overflow: hidden;

  // ---- 背景光晕（与解锁页同语言）----
  &__glow {
    position: absolute;
    border-radius: $radius-pill;
    pointer-events: none;
    z-index: $z-bg-glow;

    &--top {
      top: -88.39px;
      left: -39px;
      width: 234px;
      height: 353.59px;
      background-color: $color-brand-glow;
      filter: blur(50px);
    }

    &--bottom {
      right: -19.5px;
      bottom: -44.18px;
      width: 195px;
      height: 353.59px;
      background-color: $color-health-glow;
      filter: blur(40px);
    }
  }

  // ---- 内容主体：可滚动，垂直居中（内容超高时顶对齐滚动）----
  &__main {
    position: relative;
    z-index: $z-content;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 100dvh;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding:
      calc(#{$spacing-xl} + env(safe-area-inset-top))
      $spacing-sm
      calc(#{$spacing-xl} + env(safe-area-inset-bottom));
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
}

// 步骤切换淡入淡出
.fade-enter-active,
.fade-leave-active {
  transition: opacity $transition-base;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
