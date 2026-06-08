<script setup>
/**
 * OnboardingView —— 新用户开户流程（全屏，两步）
 *
 * 首次启动（未开户）由路由守卫强制进入。两步：
 *   步骤 1 SetupPasswordStep —— 设置主密码（持久化），保证主密码必设且早于任何指纹录入；
 *   步骤 2 SaveRecoveryStep  —— 生成并保存恢复码，确认后解锁并进入密码库。
 *
 * 单路由内以 step 切换两步（不新增多余路由）；视觉沿用解锁页的光晕 + 居中布局语言。
 * 指纹保持默认关闭，开户不触碰，用户日后在设置页自行开启。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import SetupPasswordStep from './components/SetupPasswordStep.vue'
import SaveRecoveryStep from './components/SaveRecoveryStep.vue'

import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

/** 当前步骤：1=设主密码 / 2=存恢复码 */
const step = ref(1)

/** 步骤 1 完成：主密码已持久化，进入步骤 2 */
function onPasswordDone() {
  step.value = 2
}

/** 步骤 2 完成：身份已于开户设立，标记解锁并进入密码库 */
function onRecoveryDone() {
  authStore.markUnlocked()
  router.replace({ name: 'Vault' })
}
</script>

<template>
  <div class="onboarding-page">
    <!-- 背景氛围光晕（不参与交互） -->
    <div class="onboarding-page__glow onboarding-page__glow--top" aria-hidden="true"></div>
    <div class="onboarding-page__glow onboarding-page__glow--bottom" aria-hidden="true"></div>

    <div class="onboarding-page__main">
      <Transition name="fade" mode="out-in">
        <SetupPasswordStep v-if="step === 1" key="step1" @done="onPasswordDone" />
        <SaveRecoveryStep v-else key="step2" @done="onRecoveryDone" />
      </Transition>
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
