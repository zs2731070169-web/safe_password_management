<script setup>
/**
 * PasswordView —— 账户密码登录界面（uni-app 版，全屏自绘顶栏）
 *
 * 统一身份后用云账户（邮箱 + 密码）登录。结构（自上而下，三段 space-between）：
 *   1. 背景氛围光晕（左上蓝 / 右下绿）
 *   2. 顶部品牌区：方形盾牌徽标 + 标题 + 副标题
 *   3. 中部表单：邮箱输入 + 密码输入 + 登录主按钮
 *   4. 底部次要操作：改用指纹登录 + 忘记密码 + 新用户注册
 *
 * 邮箱预填已绑定账户（软登出后仍记住）。交互编排复用 useUnlock：登录成功跳转密码库。
 */
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'

import AppIcon from '@/components/icons/AppIcon.vue'
import PasswordInput from './components/PasswordInput.vue'

import { navTo, navReplace, navBack } from '@/utils/navigation'
import { useUnlock } from '@/composables/useUnlock'
import { useSettingsStore } from '@/stores/settings'
import { useCloudAccountStore } from '@/stores/cloudAccount'

const { loading, loginByPassword, loginByBiometric } = useUnlock()

const cloudStore = useCloudAccountStore()

// 「改用指纹登录」入口显隐：需已开启指纹且安全区存有主密码凭据（退出 / 改密 / 重置后自动消失）
const { biometric } = storeToRefs(useSettingsStore())
const { hasBiometricCredential } = storeToRefs(cloudStore)
const canBiometricLogin = computed(() => biometric.value && hasBiometricCredential.value)

/** 邮箱（预填已绑定账户，软登出后仍记住） */
const email = ref(cloudStore.email || '')
/** 密码输入值 */
const password = ref('')

/** 提交密码登录 */
function handleUnlock() {
  if (loading.value) return
  loginByPassword({ email: email.value, password: password.value })
}

/** 忘记密码 → 跳转邮箱验证码重置页 */
function handleForgotPassword() {
  navTo('ResetPassword')
}

/** 新用户注册 → 跳转创建云账户页（带 register 意图，放行已注册用户重新注册） */
function handleRegister() {
  if (loading.value) return
  navTo('Onboarding', { register: '1' })
}

/** 返回解锁首页：有上层页则后退（触发向右滑回），否则重定向回登录首页 */
function handleBack() {
  if (loading.value) return
  const pages = getCurrentPages()
  if (pages.length > 1) {
    navBack()
  } else {
    navReplace('Unlock')
  }
}
</script>

<template>
  <view class="mp-page">
    <!-- 背景氛围光晕（不参与交互） -->
    <view class="mp-page__glow mp-page__glow--top" aria-hidden="true"></view>
    <view class="mp-page__glow mp-page__glow--bottom" aria-hidden="true"></view>

    <!-- 顶部返回（回解锁首页改选指纹 / 新用户注册） -->
    <view class="mp-page__topbar">
      <button
        type="button"
        class="mp-page__back"
        aria-label="返回解锁首页"
        :disabled="loading"
        @click="handleBack"
      >
        <AppIcon name="arrow-left" :size="16" />
        <text>返回</text>
      </button>
    </view>

    <view class="mp-page__main">
      <!-- 顶部品牌区 -->
      <view class="mp-page__brand">
        <view class="mp-page__logo">
          <AppIcon name="shield-solid" :width="26" :height="33" :color="'#ffffff'" />
        </view>
        <text class="mp-page__title">登录 SafeVault</text>
        <text class="mp-page__subtitle">登录云账户以访问您的加密保险库</text>
      </view>

      <!-- 中部表单 -->
      <view class="mp-page__form">
        <!-- 邮箱 -->
        <view class="mp-email">
          <AppIcon name="mail" :size="18" class="mp-email__icon" aria-hidden="true" />
          <input
            v-model="email"
            class="mp-email__field"
            placeholder="云账户邮箱"
            :disabled="loading"
            confirm-type="next"
            aria-label="云账户邮箱"
          />
        </view>

        <PasswordInput
          v-model="password"
          :disabled="loading"
          @submit="handleUnlock"
        />

        <!-- 登录主按钮 -->
        <button
          type="button"
          class="mp-unlock-btn"
          :disabled="loading"
          @click="handleUnlock"
        >
          <text class="mp-unlock-btn__text">{{ loading ? '登录中…' : '登录' }}</text>
          <AppIcon v-if="!loading" name="arrow-right" :size="14" class="mp-unlock-btn__arrow" />
        </button>
      </view>

      <!-- 底部次要操作 -->
      <view class="mp-page__actions">
        <button
          v-if="canBiometricLogin"
          type="button"
          class="mp-text-btn mp-text-btn--brand"
          :disabled="loading"
          @click="loginByBiometric"
        >
          <AppIcon name="fingerprint" :width="15" :height="17" />
          <text>改用指纹登录</text>
        </button>

        <button type="button" class="mp-text-btn mp-text-btn--link" @click="handleForgotPassword">
          <text>忘记密码？</text>
        </button>

        <!-- 新用户注册（品牌色，正向 SA） -->
        <button
          type="button"
          class="mp-text-btn mp-text-btn--register"
          :disabled="loading"
          @click="handleRegister"
        >
          <text>没有账号？新用户注册</text>
        </button>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.mp-page {
  position: relative;
  min-height: 100vh;
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

  // ---- 顶部返回（绝对定位，浮于居中内容之上，与开户页同语言）----
  &__topbar {
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

    &:hover:not(:disabled) {
      background-color: rgba($color-brand, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  // ---- 内容主体：三段 space-between ----
  &__main {
    position: relative;
    z-index: $z-content;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 100vh;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    // 上下 48px，叠加状态栏 / Home 条安全区
    padding:
      calc(#{$spacing-3xl} + #{$safe-area-top})
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
    @include circle(64px);
    width: 64px;
    height: 64px;
    background-color: $color-brand-bright;
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

// 邮箱输入（与主密码输入框 mp-input 同款视觉）
.mp-email {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 56px;
  background-color: $color-bg-input;
  border: 2px solid transparent;
  border-radius: $radius-md;
  transition: border-color $transition-base;

  &:focus-within {
    border-color: $color-brand;
  }

  &__icon {
    position: absolute;
    left: $spacing-sm;
    color: $color-text-muted;
    pointer-events: none;
  }

  &__field {
    @include button-reset;
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 $spacing-sm 0 44px; // 左让出邮箱图标
    font-size: $font-size-input;
    line-height: $line-height-body;
    color: $color-text-strong;
    cursor: text;

    &::placeholder {
      color: $color-text-muted;
    }

    &:disabled {
      cursor: not-allowed;
    }
  }
}

// 登录 —— 主按钮
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

// 文字按钮（指纹链接 / 忘记主密码 / 注册）
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

    text {
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

  // 新用户注册（品牌色，正向 SA）
  &--register {
    color: rgba($color-brand, 0.8);

    &:hover {
      color: rgba($color-brand, 1);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }
}
</style>
