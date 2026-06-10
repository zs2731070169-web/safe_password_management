<script setup>
/**
 * UnlockView —— 启动 / 解锁页
 *
 * 像素级还原 Figma「启动·解锁页」(node 3312:925)。
 * 结构（自上而下）：
 *   1. 背景氛围光晕（左上 / 右下）
 *   2. 顶部品牌导航 AppHeader
 *   3. 主内容：品牌徽标区 + 生物识别按钮 + 次要操作
 *   4. 底部信任徽章
 */
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import AppHeader from './components/AppHeader.vue'
import BrandIdentity from './components/BrandIdentity.vue'
import BiometricButton from './components/BiometricButton.vue'
import TrustBadge from './components/TrustBadge.vue'
import AppIcon from '@/components/icons/AppIcon.vue'

import { useUnlock } from '@/composables/useUnlock'
import { useSettingsStore } from '@/stores/settings'

const { loading, loginByBiometric } = useUnlock()
const router = useRouter()

// 是否已启用/录入生物识别：未启用时登录页不展示指纹登录入口（录入只在设置页进行）
const { biometric } = storeToRefs(useSettingsStore())

/** 跳转到独立的账户密码登录界面 */
function goMasterPassword() {
  if (loading.value) return
  router.push({ name: 'MasterPassword' })
}

/** 新用户注册 → 跳转创建云账户页（带 register 意图，放行已注册用户重新注册） */
function handleRegister() {
  router.push({ name: 'Onboarding', query: { register: '1' } })
}
</script>

<template>
  <div class="unlock-page">
    <!-- 背景氛围光晕（不参与交互） -->
    <div class="unlock-page__glow unlock-page__glow--top" aria-hidden="true"></div>
    <div class="unlock-page__glow unlock-page__glow--bottom" aria-hidden="true"></div>

    <!-- 顶部导航 -->
    <AppHeader class="unlock-page__header" />

    <!-- 主内容 -->
    <main class="unlock-page__main">
      <BrandIdentity />

      <section class="unlock-page__biometric">
        <BiometricButton v-if="biometric" :loading="loading" @trigger="loginByBiometric" />

        <div class="unlock-page__secondary">
          <!-- 使用密码登录 -->
          <button
            type="button"
            class="master-btn"
            :disabled="loading"
            @click="goMasterPassword"
          >
            <AppIcon name="key" :width="22" :height="12" :color="'#004ac6'" />
            <span class="master-btn__text">使用密码登录</span>
          </button>

          <!-- 新用户注册 -->
          <button type="button" class="register-btn" @click="handleRegister">
            没有账号？新用户注册
          </button>
        </div>
      </section>
    </main>

    <!-- 底部信任徽章 -->
    <footer class="unlock-page__footer">
      <TrustBadge />
    </footer>
  </div>
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
  &__main {
    @include flex-col-center;
    justify-content: center;
    flex: 1;
    gap: $spacing-3xl; // 品牌区与生物识别区间距 48px
    width: 100%;
    max-width: $layout-content-max-width;
    padding: 0 $spacing-sm;
  }

  &__biometric {
    @include flex-col-center;
    gap: $spacing-2xl; // 指纹按钮与次要操作间距 40px
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
  gap: $spacing-xs;
  width: 100%;
  padding: $spacing-md $spacing-lg; // 18px / 24px
  border: 2px solid $color-border;
  border-radius: $radius-md;
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

  &__text {
    font-size: $font-size-body;
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    color: $color-brand;
  }
}

// 新用户注册 —— 文字链接（品牌色，正向 CTA）
.register-btn {
  @include button-reset;
  padding: 4px 8px;
  font-size: $font-size-caption;
  line-height: $line-height-caption;
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
