<script setup>
/**
 * ResetPasswordView —— 忘记密码：邮箱验证码重置账户密码 + 恢复码恢复数据（uni-app 版，两步）
 *
 * 统一身份后找回改为邮箱验证码重置。用户从登录页「忘记密码？」进入：
 *   步骤一（reset）：填邮箱（预填已记住账户，或由 query 带入）→ 发送验证码 →
 *     输验证码 + 新密码 → 重置成功。
 *   步骤二（recover）：重置成功后（store.pendingRecovery 为 true），此前数据用旧密码包裹的
 *     DataKey 已作废，需用「恢复码」取回 DataKey 才能找回数据；输入恢复码恢复（或放弃重建，
 *     符合零知识——用户可日后再恢复）。
 *
 * 结构（自上而下）：顶栏 → 状态区 → 卡片 → 底部操作栏。交互编排复用 useCloudAccount。
 */
import { ref, computed, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

import AppIcon from '@/components/icons/AppIcon.vue'
import ResetPasswordHeader from './components/ResetPasswordHeader.vue'
import RecoverDataStep from './components/RecoverDataStep.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordStrength from '@/components/PasswordStrength.vue'

import { navReplace, decodeParam } from '@/utils/navigation'
import { useCloudAccount } from '@/composables/useCloudAccount'
import { useCloudAccountStore } from '@/stores/cloudAccount'

const cloudStore = useCloudAccountStore()
const { sendingCode, authenticating, sendCode, resetPassword, cleanup } = useCloudAccount()

/** 当前步骤：reset 重置密码 | recover 恢复码恢复数据 */
const step = ref('reset')

/** 邮箱（预填已绑定账户，便于直接发码；query 带入时覆盖） */
const email = ref(cloudStore.email || '')
const code = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

// 取参：忘记密码入口可能带 email query（如从其他页携带），有则覆盖预填。
// App 端 onLoad query 可能未自动解码，邮箱里的 @ 会是 %40，需经 decodeParam 还原。
onLoad((query) => {
  if (query && query.email) email.value = decodeParam(query.email)
})

/** 重发验证码倒计时（秒） */
const countdown = ref(0)
let countdownTimer = null

/** 两次输入不一致（确认框已输入时才提示） */
const mismatch = computed(
  () => confirmPassword.value.length > 0 && confirmPassword.value !== newPassword.value
)

/** 发送验证码按钮文案 */
const sendCodeText = computed(() => {
  if (countdown.value > 0) return `${countdown.value}s 后重发`
  if (sendingCode.value) return '发送中…'
  return '发送验证码'
})

/** 可提交：邮箱 / 验证码 / 两次新密码均已填且一致，且非提交中 */
const canSubmit = computed(
  () =>
    email.value.length > 0 &&
    code.value.length > 0 &&
    newPassword.value.length > 0 &&
    confirmPassword.value.length > 0 &&
    newPassword.value === confirmPassword.value &&
    !authenticating.value
)

function startCountdown() {
  clearCountdown()
  countdown.value = 60
  countdownTimer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) clearCountdown()
  }, 1000)
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  countdown.value = 0
}

/** 发送验证码：成功后进入倒计时 */
async function onSendCode() {
  if (countdown.value > 0 || sendingCode.value) return
  const ok = await sendCode(email.value.trim())
  if (ok) startCountdown()
}

/** 提交重置：成功即登录，但先进入「恢复码恢复数据」步骤（数据需恢复码取回，不直接进库） */
async function handleSubmit() {
  if (!canSubmit.value) return
  const ok = await resetPassword({ code: code.value.trim(), newPassword: newPassword.value })
  if (ok) {
    cloudStore.markLoggedIn()
    // store.resetPassword 成功后已置 pendingRecovery=true：转入恢复码恢复步骤
    step.value = 'recover'
  }
}

/** 恢复 / 重建完成：进入密码库（RecoverDataStep 内部已处理恢复成功的反馈） */
function onRecoverDone() {
  navReplace('Vault')
}

onUnmounted(() => {
  clearCountdown()
  cleanup()
})
</script>

<template>
  <view class="reset-page">
    <ResetPasswordHeader />

    <!-- 步骤一：邮箱验证码重置密码 -->
    <template v-if="step === 'reset'">
      <view class="reset-page__main">
        <!-- 状态区 -->
        <view class="reset-status">
          <view class="reset-status__badge">
            <AppIcon name="shield-check" :width="20" :height="25" />
          </view>
          <text class="reset-status__title">重置密码</text>
          <text class="reset-status__desc">通过邮箱验证码重置账户密码，重置后即可登录</text>
        </view>

        <!-- 安全卡片 -->
        <view class="reset-card">
          <!-- 邮箱 -->
          <view class="acc-field">
            <text class="acc-field__label">邮箱</text>
            <view class="acc-field__control">
              <AppIcon name="mail" :size="18" class="acc-field__icon" />
              <input
                class="acc-field__input acc-field__input--with-icon"
                v-model="email"
                placeholder="you@example.com"
                :disabled="authenticating"
              />
            </view>
          </view>

          <!-- 邮箱验证码 -->
          <view class="acc-field">
            <text class="acc-field__label">邮箱验证码</text>
            <view class="acc-field__control">
              <input
                class="acc-field__input acc-field__input--with-send"
                v-model="code"
                placeholder="6 位验证码"
                type="number"
                maxlength="6"
                :disabled="authenticating"
              />
              <button
                type="button"
                class="acc-field__send"
                :disabled="!email || sendingCode || countdown > 0 || authenticating"
                @click="onSendCode"
              >
                {{ sendCodeText }}
              </button>
            </view>
          </view>

          <!-- 新密码 + 强度计 -->
          <view class="reset-card__group">
            <PasswordField
              v-model="newPassword"
              label="新密码"
              placeholder="请输入高强度密码"
              :disabled="authenticating"
              @submit="handleSubmit"
            />
            <PasswordStrength :password="newPassword" />
          </view>

          <!-- 确认密码 -->
          <PasswordField
            v-model="confirmPassword"
            label="确认密码"
            placeholder="再次输入新密码"
            :error="mismatch"
            error-text="两次输入的密码不一致"
            :disabled="authenticating"
            @submit="handleSubmit"
          />

          <!-- 安全建议 -->
          <view class="reset-card__hint">
            <AppIcon name="info" :width="12" :height="14" class="reset-card__hint-icon" />
            <text class="reset-card__hint-text">
              建议使用包含大小写字母、数字及特殊字符的组合，长度至少 12 位。
            </text>
          </view>
        </view>
      </view>

      <!-- 底部毛玻璃操作栏 -->
      <view class="reset-page__footer">
        <button
          type="button"
          class="reset-submit"
          :disabled="!canSubmit"
          @click="handleSubmit"
        >
          <text>{{ authenticating ? '重置中…' : '重置并登录' }}</text>
          <AppIcon v-if="!authenticating" name="login" :size="18" class="reset-submit__icon" />
        </button>
      </view>
    </template>

    <!-- 步骤二：恢复码恢复数据（重置后此前数据已用旧密码包裹作废，需恢复码取回） -->
    <RecoverDataStep v-else @done="onRecoverDone" />
  </view>
</template>

<style lang="scss" scoped>
.reset-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: $color-bg-page;

  // ---- 主体：可滚动，内容顶对齐 ----
  &__main {
    flex: 1;
    overflow-y: auto;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-xl $spacing-sm $spacing-lg; // 顶 32px / 左右 16px
  }

  // ---- 底部毛玻璃操作栏 ----
  &__footer {
    flex-shrink: 0;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-sm;
    padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom));
    background-color: rgba($color-tile-blue, 0.8); // 浅蓝毛玻璃底
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
}

// ---- 状态区 ----
.reset-status {
  @include flex-col-center;
  padding-bottom: $spacing-xl; // 32px

  // 绿色成功徽章
  &__badge {
    @include flex-center;
    @include circle(64px);
    margin-bottom: $spacing-sm; // 16px
    background-color: $color-health-bg;
    color: $color-health-text; // 盾牌图标跟随
  }

  &__title {
    margin-top: $spacing-xs; // 8px
    font-size: $font-size-heading; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-heading;
    color: $color-text-strong;
    text-align: center;
  }

  &__desc {
    margin-top: $spacing-xxs; // 4px
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }
}

// ---- 安全卡片 ----
.reset-card {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 字段之间 24px
  width: 100%;
  padding: $spacing-sm; // 16px
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  // 新密码字段 + 强度计为一组（间距 8px）
  &__group {
    display: flex;
    flex-direction: column;
    gap: $spacing-xs; // 8px
  }

  // 安全建议提示框
  &__hint {
    display: flex;
    align-items: flex-start;
    gap: $spacing-xs; // 8px
    padding: $spacing-2xs; // 12px
    background-color: $color-bg-input;
    border-radius: $radius-sm;
  }

  &__hint-icon {
    flex-shrink: 0;
    margin-top: 2px; // 与首行文字对齐
    color: $color-brand;
  }

  &__hint-text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
  }
}

// ---- 邮箱 / 验证码字段（与开户页同款输入视觉）----
.acc-field {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
  width: 100%;

  &__label {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-regular;
  }

  &__control {
    position: relative;
    width: 100%;
  }

  &__icon {
    position: absolute;
    top: 50%;
    left: $spacing-sm;
    transform: translateY(-50%);
    color: $color-text-muted;
    pointer-events: none;
  }

  &__input {
    @include button-reset;
    width: 100%;
    height: 56px;
    padding: 0 $spacing-sm;
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-sm;
    font-size: $font-size-input; // 18px
    color: $color-text-strong;
    cursor: text;
    transition:
      border-color $transition-base,
      box-shadow $transition-base;

    &::placeholder {
      color: $color-text-muted;
    }

    &:focus {
      border-color: $color-brand;
      box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    &--with-icon {
      padding-left: 44px;
    }

    &--with-send {
      padding-right: 116px;
    }
  }

  &__send {
    @include button-reset;
    @include flex-center;
    position: absolute;
    top: 50%;
    right: $spacing-xs;
    transform: translateY(-50%);
    height: 40px;
    padding: 0 $spacing-xs;
    border-radius: $radius-sm;
    background-color: rgba($color-link, 0.1);
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    white-space: nowrap;
    color: $color-link;
    transition:
      background-color $transition-base,
      color $transition-base,
      opacity $transition-base;

    &:hover:not(:disabled) {
      background-color: rgba($color-link, 0.16);
    }

    &:disabled {
      color: $color-text-placeholder;
      background-color: transparent;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 1px;
    }
  }
}

// ---- 底部主按钮 ----
.reset-submit {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs; // 文字与图标 8px
  width: 100%;
  height: 56px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-biometric;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  text {
    font-size: $font-size-logo; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-logo;
  }

  &__icon {
    color: $color-white;
  }

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
    opacity: 0.5;
  }
}
</style>
