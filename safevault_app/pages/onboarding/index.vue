<script setup>
/**
 * OnboardingView —— 新用户开户流程（uni-app 版，全屏，两步：创建云账户 → 展示恢复码）
 *
 * 由登录页「新用户注册」入口进入（不再是启动强制首屏）。统一身份后开户即「创建云账户」：
 * 填邮箱 + 密码 + 邮箱验证码，注册成功即登录。注册时密钥层一次性生成「恢复码」
 * （忘记密码后恢复数据的唯一凭据），故注册成功后**先展示恢复码并要求用户确认已妥存**，
 * 再进入密码库。视觉沿用解锁页的光晕 + 居中布局语言。
 * 顶部提供返回入口（仅创建账户步骤可返回；展示恢复码步骤不可返回，避免漏存）。
 * 指纹保持默认关闭，开户不触碰，用户日后在设置页自行开启。
 */
import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import AppIcon from '@/components/icons/AppIcon.vue'
import SetupPasswordStep from './components/SetupPasswordStep.vue'
import RecoveryCodeReveal from '@/components/RecoveryCodeReveal.vue'

import { navReplace, navBack } from '@/utils/navigation'
import { useCloudAccountStore } from '@/stores/cloudAccount'

const cloudStore = useCloudAccountStore()
/** 注册成功后由密钥层写入的一次性恢复码明文（展示并确认后置空） */
const { pendingRecoveryCode } = storeToRefs(cloudStore)

/** 当前步骤：account 创建账户 | recovery 展示恢复码 */
const step = ref('account')

/** 创建账户完成：register 已置为已登录，进入恢复码展示步骤（不直接进库） */
function onAccountCreated() {
  step.value = 'recovery'
}

/** 恢复码已确认妥存：清空一次性明文，进入密码库 */
function onRecoverySaved() {
  cloudStore.pendingRecoveryCode = ''
  navReplace('Vault')
}

/** 返回登录页：有上层页则后退（触发向右滑回），否则重定向回登录页 */
function handleBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    navBack()
  } else {
    navReplace('Unlock')
  }
}
</script>

<template>
  <view class="onboarding-page">
    <!-- 背景氛围光晕（不参与交互） -->
    <view class="onboarding-page__glow onboarding-page__glow--top" aria-hidden="true"></view>
    <view class="onboarding-page__glow onboarding-page__glow--bottom" aria-hidden="true"></view>

    <!-- 顶部返回（回登录页改选登录 / 忘记密码）。仅创建账户步骤可返回，
         展示恢复码步骤刻意不提供返回，避免用户在保存恢复码前误退出 -->
    <view v-if="step === 'account'" class="onboarding-page__header">
      <button
        type="button"
        class="onboarding-page__back"
        aria-label="返回登录"
        @click="handleBack"
      >
        <AppIcon name="arrow-left" :size="16" />
        <text>返回登录</text>
      </button>
    </view>

    <view class="onboarding-page__main">
      <SetupPasswordStep v-if="step === 'account'" @done="onAccountCreated" />
      <RecoveryCodeReveal
        v-else
        :code="pendingRecoveryCode"
        title="保存你的恢复码"
        subtitle="账户已创建。这是忘记密码后恢复数据的唯一凭据，仅显示这一次，请立即妥善保存。"
        confirm-text="我已保存，进入密码库"
        @confirm="onRecoverySaved"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.onboarding-page {
  position: relative;
  min-height: 100vh;
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

  // ---- 顶部返回（绝对定位，浮于居中内容之上）----
  &__header {
    position: absolute;
    top: 0;
    left: 0;
    z-index: $z-content;
    display: flex;
    align-items: center;
    width: 100%;
    max-width: $layout-content-max-width;
    height: calc(#{$layout-header-height} + #{$safe-area-top});
    padding: #{$safe-area-top} $spacing-sm 0;
  }

  &__back {
    @include button-reset;
    @include flex-center;
    gap: $spacing-xxs;
    padding: $spacing-xxs $spacing-xs;
    border-radius: $radius-sm;
    color: $color-brand;
    transition:
      opacity $transition-base,
      background-color $transition-base;

    text {
      font-size: $font-size-sm;
      line-height: $line-height-sm;
    }

    &:hover {
      background-color: rgba($color-brand, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }

  // ---- 内容主体：可滚动，垂直居中（内容超高时顶对齐滚动）----
  &__main {
    position: relative;
    z-index: $z-content;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 100vh;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding:
      calc(#{$spacing-xl} + #{$safe-area-top})
      $spacing-sm
      calc(#{$spacing-xl} + env(safe-area-inset-bottom));
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
}
</style>
