<script setup>
/**
 * SetupPasswordStep —— 新用户开户：创建云账户
 *
 * 统一身份后，开户即创建云账户：邮箱 + 密码 + 邮箱验证码。注册成功即登录，
 * 由父级跳转密码库。结构沿用安全卡片：邮箱 + 验证码（发送按钮，60s 倒计时）+
 * 密码（含强度计）+ 确认密码 + 安全建议。交互编排复用 useCloudAccount。
 */
import { ref, computed, onUnmounted } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordStrength from '@/components/PasswordStrength.vue'

import { useCloudAccount } from '@/composables/useCloudAccount'

const emit = defineEmits(['done'])

const { sendingCode, authenticating, sendCode, register, cleanup } = useCloudAccount()

const email = ref('')
const code = ref('')
const password = ref('')
const confirmPassword = ref('')

/** 重发验证码倒计时（秒），> 0 时禁用「发送验证码」 */
const countdown = ref(0)
let countdownTimer = null

/** 两次输入不一致（确认框已输入时才提示） */
const mismatch = computed(
  () => confirmPassword.value.length > 0 && confirmPassword.value !== password.value
)

/** 发送验证码按钮文案（倒计时中显示剩余秒数） */
const sendCodeText = computed(() => {
  if (countdown.value > 0) return `${countdown.value}s 后重发`
  if (sendingCode.value) return '发送中…'
  return '发送验证码'
})

/** 可提交：邮箱 / 验证码 / 两次密码均已填且一致，且非提交中 */
const canSubmit = computed(
  () =>
    email.value.length > 0 &&
    code.value.length > 0 &&
    password.value.length > 0 &&
    confirmPassword.value.length > 0 &&
    password.value === confirmPassword.value &&
    !authenticating.value
)

/** 启动 60s 重发倒计时 */
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

/** 提交创建账户，成功后通知父级进入密码库 */
async function handleSubmit() {
  if (!canSubmit.value) return
  const ok = await register({
    email: email.value.trim(),
    password: password.value,
    code: code.value.trim()
  })
  if (ok) emit('done')
}

onUnmounted(() => {
  clearCountdown()
  cleanup()
})
</script>

<template>
  <main class="setup-step">
    <!-- 状态区 -->
    <div class="setup-status">
      <div class="setup-status__badge">
        <AppIcon name="shield-solid" :width="26" :height="33" :color="'#ffffff'" />
      </div>
      <h1 class="setup-status__title">创建云账户</h1>
      <p class="setup-status__desc">
        云账户是访问保险库的唯一身份；密码仍在本地加密，云端只存密文。
      </p>
    </div>

    <!-- 安全卡片 -->
    <section class="setup-card">
      <!-- 邮箱 -->
      <div class="acc-field">
        <label class="acc-field__label">邮箱</label>
        <div class="acc-field__control">
          <AppIcon name="mail" :size="18" class="acc-field__icon" />
          <input
            class="acc-field__input acc-field__input--with-icon"
            type="email"
            v-model="email"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
            :disabled="authenticating"
          />
        </div>
      </div>

      <!-- 邮箱验证码 -->
      <div class="acc-field">
        <label class="acc-field__label">邮箱验证码</label>
        <div class="acc-field__control">
          <input
            class="acc-field__input acc-field__input--with-send"
            type="text"
            v-model="code"
            placeholder="6 位验证码"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
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
        </div>
      </div>

      <!-- 密码 + 强度计 -->
      <div class="setup-card__group">
        <PasswordField
          v-model="password"
          label="密码"
          placeholder="请输入高强度密码"
          :disabled="authenticating"
          @submit="handleSubmit"
        />
        <PasswordStrength :password="password" />
      </div>

      <!-- 确认密码 -->
      <PasswordField
        v-model="confirmPassword"
        label="确认密码"
        placeholder="再次输入密码"
        :error="mismatch"
        error-text="两次输入的密码不一致"
        :disabled="authenticating"
        @submit="handleSubmit"
      />

      <div class="setup-card__hint">
        <AppIcon name="info" :width="12" :height="14" class="setup-card__hint-icon" />
        <p class="setup-card__hint-text">
          建议使用包含大小写字母、数字及特殊字符的组合，长度至少 12 位。
        </p>
      </div>
    </section>

    <!-- 主行动按钮 -->
    <button
      type="button"
      class="setup-submit"
      :disabled="!canSubmit"
      @click="handleSubmit"
    >
      <span>{{ authenticating ? '创建中…' : '创建账户' }}</span>
      <AppIcon v-if="!authenticating" name="arrow-right" :size="16" class="setup-submit__icon" />
    </button>
  </main>
</template>

<style lang="scss" scoped>
.setup-step {
  display: flex;
  flex-direction: column;
  gap: $spacing-xl; // 状态区 / 卡片 / 按钮之间 32px
  width: 100%;
}

// ---- 状态区 ----
.setup-status {
  @include flex-col-center;

  &__badge {
    @include flex-center;
    @include circle(64px);
    margin-bottom: $spacing-sm; // 16px
    background-color: $color-brand-bright;
    box-shadow: $shadow-biometric;
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
    max-width: 300px;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }
}

// ---- 安全卡片 ----
.setup-card {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 字段之间 24px
  width: 100%;
  padding: $spacing-sm; // 16px
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  &__group {
    display: flex;
    flex-direction: column;
    gap: $spacing-xs; // 8px
  }

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
    margin-top: 2px;
    color: $color-brand;
  }

  &__hint-text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
  }
}

// ---- 邮箱 / 验证码字段（与 PasswordField 同款输入视觉）----
.acc-field {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 标签与输入框 8px
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
    border-radius: $radius-sm; // 8px
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

    // 左侧让出邮箱图标
    &--with-icon {
      padding-left: 44px;
    }

    // 右侧让出「发送验证码」按钮
    &--with-send {
      padding-right: 116px;
    }
  }

  // 行内发送验证码按钮
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
    font-size: $font-size-sm; // 14px
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

// ---- 主行动按钮 ----
.setup-submit {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs; // 8px
  width: 100%;
  height: 56px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  span {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
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
