<script setup>
/**
 * UnlockView —— 启动 / 解锁页（uni-app 版，全屏自绘顶栏）
 *
 * 结构（自上而下）：
 *   1. 背景氛围光晕（左上 / 右下）
 *   2. 顶部品牌导航 AppHeader（unlock 私有）
 *   3. 主内容：品牌徽标区 + 生物识别按钮 + 次要操作
 *   4. 底部信任徽章
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import AppHeader from './components/AppHeader.vue'
import BrandIdentity from './components/BrandIdentity.vue'
import BiometricButton from './components/BiometricButton.vue'
import TrustBadge from './components/TrustBadge.vue'

import { navTo } from '@/utils/navigation'
import { useUnlock } from '@/composables/useUnlock'
import { useSettingsStore } from '@/stores/settings'
import { useCloudAccountStore } from '@/stores/cloudAccount'

const { loading, loginByBiometric } = useUnlock()

// 指纹登录入口显隐：需「已开启指纹」且「安全区存有主密码凭据」。
// 后者保证退出 / 改密 / 重置后入口自动消失，避免指纹进入却拿不到合法会话的僵尸态（录入只在设置页进行）。
const { biometric } = storeToRefs(useSettingsStore())
const { hasBiometricCredential } = storeToRefs(useCloudAccountStore())
const canBiometricLogin = computed(() => biometric.value && hasBiometricCredential.value)

/** 跳转到独立的账户密码登录界面 */
function goMasterPassword() {
  if (loading.value) return
  navTo('MasterPassword')
}

/** 新用户注册 → 跳转创建云账户页（带 register 意图，放行已注册用户重新注册） */
function handleRegister() {
  navTo('Onboarding', { register: '1' })
}
</script>

<template>
  <view class="unlock-page">
    <!-- 背景氛围光晕（不参与交互） -->
    <view class="unlock-page__glow unlock-page__glow--top" aria-hidden="true"></view>
    <view class="unlock-page__glow unlock-page__glow--bottom" aria-hidden="true"></view>

    <!-- 顶部导航 -->
    <AppHeader class="unlock-page__header" />

    <!-- 主内容 -->
    <view class="unlock-page__main">
      <BrandIdentity :biometricLoginTip="canBiometricLogin" />

      <view class="unlock-page__biometric">
        <BiometricButton v-if="canBiometricLogin" :loading="loading" @trigger="loginByBiometric" />

        <view class="unlock-page__secondary">
          <!-- 使用密码登录 -->
          <button
            type="button"
            class="master-btn"
            :disabled="loading"
            @click="goMasterPassword"
          >
            <text class="master-btn__mask" aria-hidden="true">***</text>
            <text class="master-btn__text">使用密码登录</text>
          </button>

          <!-- 新用户注册 -->
          <button type="button" class="register-btn" @click="handleRegister">
            <text>没有账号？新用户注册</text>
          </button>
        </view>
      </view>
    </view>

    <!-- 底部信任徽章 -->
    <view class="unlock-page__footer">
      <TrustBadge />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.unlock-page {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  min-height: 100vh;
  background-color: $color-bg-page;
  overflow: hidden;

  // ---- 背景光晕 ----
  &__glow {
    position: absolute;
    width: 156px;
    height: 262.39px;
    border-radius: $radius-pill;
    background-color: $color-brand-glow;
    filter: blur(60px);
    pointer-events: none;
    z-index: $z-bg-glow;

    &--top {
      top: -65.59px;
      left: -39px;
    }

    &--bottom {
      right: -39px;
      bottom: -65.59px;
    }
  }

  // 内容层位于光晕之上
  &__header,
  &__main,
  &__footer {
    position: relative;
    z-index: $z-content;
    width: 100%;
  }

  &__header {
    flex-shrink: 0;
  }

  // ---- 主内容 ----
  // 居中的内容块向上下两端撑开（拉大内部间距），品牌区上移、操作区下沉，贴合参考图留白节奏
  &__main {
    @include flex-col-center;
    justify-content: center;
    flex: 1;
    gap: $spacing-3xl + $spacing-xs; // 品牌区与生物识别区间距 56px
    width: 100%;
    max-width: $layout-content-max-width;
    padding: 0 $spacing-sm;
  }

  &__biometric {
    @include flex-col-center;
    gap: $spacing-3xl + $spacing-sm; // 指纹按钮与次要操作间距 64px
    width: 100%;
  }

  &__secondary {
    @include flex-col-center;
    gap: $spacing-sm; // 主密码按钮与忘记链接间距 16px
    width: 100%;
  }

  // ---- 底部 ----
  &__footer {
    @include flex-col-center;
    flex-shrink: 0;
    // 上下 32px，底部叠加 Home 条安全区
    padding: $spacing-xl 0 calc(#{$spacing-xl} + env(safe-area-inset-bottom));
  }
}

// 使用主密码解锁 —— 描边按钮
.master-btn {
  @include button-reset;
  @include flex-center;
  gap: $spacing-2xs; // 掩码与文字间距 10px
  width: 100%;
  padding: $spacing-md $spacing-lg; // 18px / 24px
  border: 2px solid $color-border;
  border-radius: $radius-lg; // 16px 大圆角，贴合参考图
  transition:
    border-color $transition-base,
    background-color $transition-base;

  &:hover:not(:disabled) {
    border-color: $color-brand;
    background-color: rgba($color-brand, 0.04);
  }

  &:active:not(:disabled) {
    background-color: rgba($color-brand, 0.08);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.3);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  // *** 星号掩码：等宽字体 + 品牌蓝 + 底部下划线，还原参考图「密码输入」意象
  &__mask {
    font-family: $font-family-mono;
    font-size: $font-size-body;
    font-weight: $font-weight-bold;
    line-height: 1;
    letter-spacing: 1px;
    color: $color-brand;
    border-bottom: 2px solid $color-brand;
    padding-bottom: 3px;
  }

  &__text {
    font-size: $font-size-body;
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    color: $color-brand;
  }
}

// 新用户注册 —— 文字链接（品牌色，正向 SA）
.register-btn {
  @include button-reset;
  padding: 4px 8px;
  font-size: $font-size-sm; // 14px，较底部徽章更醒目（参考图）
  line-height: $line-height-sm;
  letter-spacing: $letter-spacing-caption;
  color: $color-brand;
  transition: opacity $transition-base;

  &:hover {
    opacity: 0.75;
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
    border-radius: 4px;
  }
}
</style>
