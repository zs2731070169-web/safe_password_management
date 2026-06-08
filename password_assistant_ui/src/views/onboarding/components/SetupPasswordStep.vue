<script setup>
/**
 * SetupPasswordStep —— 新用户开户·步骤 1：设置主密码
 *
 * 结构对齐 ResetPasswordView 的安全卡片：新主密码（含强度计）+ 确认密码 + 安全建议。
 * 这是开户的第一步，也是整个保险库的根凭证——主密码必设且早于任何指纹录入。
 * 交互编排复用 useOnboarding：提交持久化主密码，成功后通知父级切到步骤 2。
 */
import { ref, computed, onUnmounted } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordStrength from '@/components/PasswordStrength.vue'

import { useOnboarding } from '@/composables/useOnboarding'

const emit = defineEmits(['done'])

const { submitting, setupMasterPassword, cleanup } = useOnboarding()

const password = ref('')
const confirmPassword = ref('')

/** 两次输入不一致（确认框已输入时才提示） */
const mismatch = computed(
  () => confirmPassword.value.length > 0 && confirmPassword.value !== password.value
)

/** 可提交：两次均非空且一致，且非提交中 */
const canSubmit = computed(
  () =>
    password.value.length > 0 &&
    confirmPassword.value.length > 0 &&
    password.value === confirmPassword.value &&
    !submitting.value
)

/** 提交并设置主密码，成功后进入步骤 2 */
async function handleSubmit() {
  if (!canSubmit.value) return
  const ok = await setupMasterPassword(password.value)
  if (ok) emit('done')
}

onUnmounted(cleanup)
</script>

<template>
  <main class="setup-step">
    <!-- 状态区：步骤 1/2 进度 -->
    <div class="setup-status">
      <div class="setup-status__badge">
        <AppIcon name="shield-solid" :width="20" :height="25" :color="'#ffffff'" />
      </div>
      <div class="setup-status__progress">
        <span class="setup-status__step">步骤 1/2</span>
        <span class="setup-status__bars">
          <span class="setup-status__bar setup-status__bar--on"></span>
          <span class="setup-status__bar"></span>
        </span>
      </div>
      <h1 class="setup-status__title">设置主密码</h1>
      <p class="setup-status__desc">主密码是保护您保险库的唯一钥匙，请牢记，它无法被找回。</p>
    </div>

    <!-- 安全卡片 -->
    <section class="setup-card">
      <div class="setup-card__group">
        <PasswordField
          v-model="password"
          label="主密码"
          placeholder="请输入高强度密码"
          :disabled="submitting"
          @submit="handleSubmit"
        />
        <PasswordStrength :password="password" />
      </div>

      <PasswordField
        v-model="confirmPassword"
        label="确认主密码"
        placeholder="再次输入主密码"
        :error="mismatch"
        error-text="两次输入的密码不一致"
        :disabled="submitting"
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
      <span>{{ submitting ? '设置中…' : '下一步' }}</span>
      <AppIcon v-if="!submitting" name="arrow-right" :size="16" class="setup-submit__icon" />
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

  &__progress {
    display: flex;
    align-items: center;
    gap: $spacing-xs; // 8px
    margin-bottom: $spacing-xs; // 8px
  }

  &__step {
    font-family: $font-family-mono;
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-bold;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-brand;
  }

  &__bars {
    display: flex;
    gap: $spacing-xxs; // 4px
  }

  &__bar {
    width: 32px;
    height: 4px;
    background-color: rgba($color-brand, 0.25); // 未达步骤：淡
    border-radius: $radius-pill;

    &--on {
      background-color: $color-brand; // 当前步骤：亮
    }
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
