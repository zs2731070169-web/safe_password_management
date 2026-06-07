<script setup>
/**
 * MasterPasswordView —— 主密码解锁界面
 *
 * 像素级还原 Figma「启动/解锁页-带主密码输入态」(node 1:525)。
 * 结构（自上而下，三段 space-between）：
 *   1. 背景氛围光晕（左上蓝 / 右下绿）
 *   2. 顶部品牌区：方形盾牌徽标 + 标题 + 副标题
 *   3. 中部表单：主密码输入框 + 立即解锁主按钮 + 生物识别就绪卡
 *   4. 底部次要操作：改用指纹解锁 + 忘记主密码
 *
 * 交互编排复用 useUnlock：解锁成功跳转密码库（Vault），失败 ElMessage 提示。
 */
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/icons/AppIcon.vue'
import PasswordInput from './components/PasswordInput.vue'

import { useUnlock } from '@/composables/useUnlock'
import { useSettingsStore } from '@/stores/settings'

const { loading, unlockByMasterPassword, unlockByBiometric } = useUnlock()
const router = useRouter()

// 未启用生物识别时不展示「改用指纹解锁」入口
const { biometric } = storeToRefs(useSettingsStore())

/** 主密码输入值 */
const password = ref('')

/** 提交主密码解锁 */
function handleUnlock() {
  if (loading.value) return
  unlockByMasterPassword(password.value)
}

/** 忘记主密码 → 跳转恢复码页面 */
function handleForgotPassword() {
  router.push({ name: 'RecoveryCode' })
}
</script>

<template>
  <div class="mp-page">
    <!-- 背景氛围光晕（不参与交互） -->
    <div class="mp-page__glow mp-page__glow--top" aria-hidden="true"></div>
    <div class="mp-page__glow mp-page__glow--bottom" aria-hidden="true"></div>

    <div class="mp-page__main">
      <!-- 顶部品牌区 -->
      <header class="mp-page__brand">
        <div class="mp-page__logo">
          <AppIcon name="shield-solid" :width="26.667" :height="33.333" :color="'#ffffff'" />
        </div>
        <h1 class="mp-page__title">请输入主密码解锁</h1>
        <p class="mp-page__subtitle">验证身份以访问您的加密保管库</p>
      </header>

      <!-- 中部表单 -->
      <section class="mp-page__form">
        <PasswordInput
          v-model="password"
          :disabled="loading"
          @submit="handleUnlock"
        />

        <!-- 立即解锁主按钮 -->
        <button
          type="button"
          class="mp-unlock-btn"
          :disabled="loading"
          @click="handleUnlock"
        >
          <span class="mp-unlock-btn__text">{{ loading ? '解锁中…' : '立即解锁' }}</span>
          <AppIcon v-if="!loading" name="arrow-right" :size="14" class="mp-unlock-btn__arrow" />
        </button>
      </section>

      <!-- 底部次要操作 -->
      <footer class="mp-page__actions">
        <button
          v-if="biometric"
          type="button"
          class="mp-text-btn mp-text-btn--brand"
          :disabled="loading"
          @click="unlockByBiometric"
        >
          <AppIcon name="fingerprint" :width="15" :height="17" />
          <span>改用指纹解锁</span>
        </button>

        <button type="button" class="mp-text-btn mp-text-btn--link" @click="handleForgotPassword">
          忘记主密码？
        </button>
      </footer>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.mp-page {
  position: relative;
  min-height: 100dvh;
  background-color: $color-bg-page;
  overflow: hidden;

  // ---- 背景光晕 ----
  &__glow {
    position: absolute;
    border-radius: $radius-pill;
    pointer-events: none;
    z-index: $z-bg-glow;

    // 左上蓝色光晕（234×353.59，blur 50）
    &--top {
      top: -88.39px;
      left: -39px;
      width: 234px;
      height: 353.59px;
      background-color: $color-brand-glow;
      filter: blur(50px);
    }

    // 右下绿色光晕（195×353.59，blur 40）
    &--bottom {
      right: -19.5px;
      bottom: -44.18px;
      width: 195px;
      height: 353.59px;
      background-color: $color-health-glow;
      filter: blur(40px);
    }
  }

  // ---- 内容主体：三段 space-between ----
  &__main {
    position: relative;
    z-index: $z-content;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 100dvh;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    // 上下 48px，叠加状态栏 / Home 条安全区
    padding:
      calc(#{$spacing-3xl} + env(safe-area-inset-top))
      $spacing-sm
      calc(#{$spacing-3xl} + env(safe-area-inset-bottom));
  }

  // ---- 顶部品牌区 ----
  &__brand {
    @include flex-col-center;
    padding-top: $spacing-xl; // 与画布顶部再留 32px 呼吸
  }

  // 方形盾牌徽标（亮蓝底白盾）
  &__logo {
    @include flex-center;
    width: 64px;
    height: 64px;
    background-color: $color-brand-bright;
    border-radius: $radius-lg;
    box-shadow: $shadow-biometric;
  }

  &__title {
    margin: $spacing-lg 0 0; // 徽标与标题间距 24px
    font-size: $font-size-logo; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-logo;
    letter-spacing: $letter-spacing-title-tight;
    color: $color-text-strong;
    text-align: center;
  }

  &__subtitle {
    margin: $spacing-xs 0 0; // 标题与副标题间距 8px
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }

  // ---- 中部表单 ----
  &__form {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm; // 输入框、主按钮间距 16px
    width: 100%;
  }

  // ---- 底部次要操作 ----
  &__actions {
    @include flex-col-center;
    gap: $spacing-lg; // 指纹链接与忘记链接间距 24px
    padding-bottom: $spacing-sm;
  }
}

// 立即解锁 —— 主按钮
.mp-unlock-btn {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs;
  width: 100%;
  height: 56px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  &:hover:not(:disabled) {
    filter: brightness(0.94);
  }

  &:active:not(:disabled) {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  &__text {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-white;
  }

  &__arrow {
    color: $color-white;
  }
}

// 文字按钮（指纹链接 / 忘记主密码）
.mp-text-btn {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs;
  padding: $spacing-xs $spacing-sm;
  border-radius: $radius-pill;
  font-size: $font-size-sm;
  line-height: $line-height-sm;
  transition:
    opacity $transition-base,
    background-color $transition-base;

  // 改用指纹解锁（品牌色，带图标）
  &--brand {
    color: $color-brand;

    span {
      font-size: $font-size-body; // 16px
      line-height: $line-height-body;
    }

    &:hover:not(:disabled) {
      background-color: rgba($color-brand, 0.06);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  // 忘记主密码（弱化文字链接）
  &--link {
    color: $color-text-muted;
    border-bottom: 1px solid transparent;
    border-radius: 0;

    &:hover {
      color: $color-text-regular;
    }
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }
}
</style>
