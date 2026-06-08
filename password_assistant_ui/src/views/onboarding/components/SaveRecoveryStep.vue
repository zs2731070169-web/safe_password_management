<script setup>
/**
 * SaveRecoveryStep —— 新用户开户·步骤 2：生成并保存恢复码
 *
 * 进入即生成一组恢复码（复用 useRecoveryCode，内部写入 recovery store，供日后找回校验）。
 * 用户可「复制」或「保存为图片」，确认「我已安全保存」后通知父级完成开户（解锁并进入密码库）。
 * 结构对齐 RecoveryCodeManageView，但去掉前置指纹验证（开户场景身份即首次设立）。
 */
import { onMounted, onUnmounted } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'
import RecoveryCodeCard from '@/views/recovery-code/components/RecoveryCodeCard.vue'

import { useRecoveryCode } from '@/composables/useRecoveryCode'

const emit = defineEmits(['done'])

const { code, generating, saving, generate, copyCode, saveAsImage, cleanup } = useRecoveryCode()

/** 确认已保存 → 完成开户 */
function onConfirmSaved() {
  if (generating.value) return
  emit('done')
}

// 进入即生成恢复码
onMounted(generate)
// 离开时取消进行中的生成请求
onUnmounted(cleanup)
</script>

<template>
  <main class="save-step">
    <!-- 状态区：步骤 2/2 进度 -->
    <div class="save-status">
      <div class="save-status__badge">
        <AppIcon name="account-key" :width="30.667" :height="16" />
      </div>
      <div class="save-status__progress">
        <span class="save-status__step">步骤 2/2</span>
        <span class="save-status__bars">
          <span class="save-status__bar save-status__bar--on"></span>
          <span class="save-status__bar save-status__bar--on"></span>
        </span>
      </div>
      <h1 class="save-status__title">保存账户恢复码</h1>
      <p class="save-status__desc">这是忘记主密码时恢复加密资料的唯一凭据，请妥善保存。</p>
    </div>

    <!-- 警示卡 -->
    <div class="save-warning">
      <AppIcon name="warning" :size="20" class="save-warning__icon" />
      <p class="save-warning__text">
        请立即复制或保存为图片。一旦丢失且忘记主密码，您的数据将无法恢复。
      </p>
    </div>

    <!-- 恢复码 + 快捷操作 -->
    <section class="save-code">
      <RecoveryCodeCard :code="code" :loading="generating" />
      <div class="save-actions">
        <button
          type="button"
          class="save-action"
          :disabled="generating"
          @click="copyCode"
        >
          <AppIcon name="copy" :width="17" :height="20" />
          <span>复制</span>
        </button>
        <button
          type="button"
          class="save-action"
          :disabled="generating || saving"
          @click="saveAsImage"
        >
          <AppIcon name="image" :size="18" />
          <span>{{ saving ? '保存中…' : '保存为图片' }}</span>
        </button>
      </div>
    </section>

    <!-- 主行动按钮 -->
    <button
      type="button"
      class="save-submit"
      :disabled="generating"
      @click="onConfirmSaved"
    >
      <span>我已安全保存，进入密码库</span>
      <AppIcon name="login" :size="18" class="save-submit__icon" />
    </button>
  </main>
</template>

<style lang="scss" scoped>
.save-step {
  display: flex;
  flex-direction: column;
  gap: $spacing-xl; // 各区块之间 32px
  width: 100%;
}

// ---- 状态区 ----
.save-status {
  @include flex-col-center;

  &__badge {
    @include flex-center;
    @include circle(64px);
    margin-bottom: $spacing-sm; // 16px
    background-color: $color-brand;
    color: $color-on-brand;
    box-shadow: $shadow-fab-neutral;
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
    background-color: rgba($color-brand, 0.25);
    border-radius: $radius-pill;

    &--on {
      background-color: $color-brand;
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

// ---- 警示卡 ----
.save-warning {
  display: flex;
  align-items: flex-start;
  gap: $spacing-2xs; // 12px
  padding: $spacing-sm; // 16px
  background-color: $color-warning-soft;
  border: 1px solid rgba($color-warning, 0.35);
  border-radius: $radius-md;

  &__icon {
    flex-shrink: 0;
    margin-top: 1px;
    color: $color-warning;
  }

  &__text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-warning;
  }
}

// ---- 恢复码 + 快捷操作 ----
.save-code {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 24px
}

.save-actions {
  display: flex;
  gap: $spacing-sm; // 16px
}

.save-action {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs; // 8px
  flex: 1;
  min-width: 0;
  height: 56px;
  border: 2px solid $color-border;
  border-radius: $radius-md;
  color: $color-text-regular;
  transition:
    background-color $transition-base,
    transform $transition-fast;

  span {
    font-size: $font-size-body; // 16px
    line-height: $line-height-body;
  }

  &:hover:not(:disabled) {
    background-color: rgba($line-base, 0.18);
  }

  &:active:not(:disabled) {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

// ---- 主行动按钮 ----
.save-submit {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs; // 8px
  width: 100%;
  height: 56px;
  background-color: $color-link; // #004ac6
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  span {
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
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
    opacity: 0.6;
  }
}
</style>
