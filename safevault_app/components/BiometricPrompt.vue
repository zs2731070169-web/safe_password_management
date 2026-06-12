<script setup>
/**
 * BiometricPrompt —— 指纹验证提示框（浏览器 mock 专用）
 *
 * 挂载在 App.vue，由 useBiometricPrompt 单例驱动。真机已改为直接拉起系统指纹框、
 * 不再渲染本弹窗；本组件仅在浏览器 / 无插件环境承载 mock 扫描动画（`npm run dev` 可调）。
 * 解锁页（开启 / 已开启验证）、设置页（开启 / 关闭前验证）共用。样式范式对齐 IdentityVerifyModal。
 */
import { computed, watch, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useBiometricPrompt } from '@/composables/useBiometricPrompt'

const { visible, mode, scanning, errorMsg, startScan, cancel } = useBiometricPrompt()

/** 按模式区分文案（系统无法「录入」指纹，统一用验证语义） */
const copy = computed(() => {
  const isEnroll = mode.value === 'enroll'
  return {
    title: '验证指纹',
    hint: isEnroll ? '验证指纹以开启快速解锁' : '请验证指纹以继续',
    idle: '轻触验证指纹',
    busy: '正在验证…'
  }
})

/** 指纹区文案：扫描中 / 失败重试 / 默认 */
const tapLabel = computed(() => {
  if (scanning.value) return copy.value.busy
  if (errorMsg.value) return '轻触重试'
  return copy.value.idle
})

// ESC 关闭 / 锁定页面滚动：H5 专属（App 无 document、无 ESC、滚动由原生承载），条件编译隔离。
// #ifdef H5
function onKeydown(event) {
  if (event.key === 'Escape') cancel()
}

// 打开 / 关闭：监听 ESC、锁定页面滚动
watch(visible, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
// #endif
</script>

<template>    <Transition name="bp-modal">
      <view v-if="visible" class="bp-modal" @click.self="cancel">
        <view
          class="bp-modal__panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="bp-modal-title"
        >
          <text id="bp-modal-title" class="bp-modal__title">{{ copy.title }}</text>
          <view class="bp-modal__hint">{{ copy.hint }}</view>

          <button
            type="button"
            class="bp-bio"
            :class="{ 'is-active': scanning, 'is-error': !!errorMsg && !scanning }"
            :disabled="scanning"
            @click="startScan"
          >
            <text class="bp-bio__ring">
              <AppIcon name="fingerprint" :width="40" :height="44" />
            </text>
            <text class="bp-bio__label">{{ tapLabel }}</text>
          </button>

          <view v-if="errorMsg" class="bp-modal__error">{{ errorMsg }}</view>

          <view class="bp-modal__actions">
            <button
              type="button"
              class="bp-btn bp-btn--ghost"
              :disabled="scanning"
              @click="cancel"
            >
              取消
            </button>
          </view>
        </view>
      </view>
    </Transition>
</template>

<style lang="scss" scoped>
.bp-modal {
  position: fixed;
  inset: 0;
  z-index: $z-overlay;
  @include flex-center;
  padding: $spacing-lg;
  background-color: $color-overlay;

  &__panel {
    @include flex-col-center;
    width: 100%;
    max-width: 332px;
    padding: $spacing-lg;
    background-color: $color-bg-card;
    border-radius: $radius-lg;
    box-shadow: $shadow-fab-neutral;
    text-align: center;
  }

  &__title {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__hint {
    margin-top: $spacing-2xs;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-muted;
  }

  &__error {
    width: 100%;
    margin-top: $spacing-sm;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-danger;
    text-align: center;
  }

  &__actions {
    display: flex;
    width: 100%;
    margin-top: $spacing-lg;
  }
}

// 指纹触发区
.bp-bio {
  @include button-reset;
  @include flex-col-center;
  gap: $spacing-xs;
  width: 100%;
  margin-top: $spacing-lg;

  &__ring {
    @include flex-center;
    @include circle(88px);
    background-color: $color-brand-soft;
    color: $color-brand;
    transition:
      background-color $transition-base,
      transform $transition-fast;
  }

  &__label {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-brand;
  }

  &:hover:not(:disabled) .bp-bio__ring {
    background-color: $color-brand-pale;
  }

  &:active:not(:disabled) .bp-bio__ring {
    transform: scale(0.96);
  }

  &:focus-visible {
    outline: none;

    .bp-bio__ring {
      outline: 3px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }

  &:disabled {
    cursor: progress;
  }

  // 验证中：脉冲
  &.is-active .bp-bio__ring {
    animation: bp-pulse 1.2s ease-in-out infinite;
  }

  // 失败态：指纹环转危险色，提示重试
  &.is-error .bp-bio__ring {
    background-color: $color-danger-soft;
    color: $color-danger;
  }
}

@keyframes bp-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.92);
    opacity: 0.6;
  }
}

// 操作按钮
.bp-btn {
  @include button-reset;
  @include flex-center;
  flex: 1;
  height: 44px;
  border-radius: $radius-sm;
  font-size: $font-size-body; // 16px
  line-height: $line-height-body;
  transition:
    background-color $transition-base,
    opacity $transition-base;

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &--ghost {
    background-color: $color-brand-pale;
    color: $color-brand;

    &:hover:not(:disabled) {
      background-color: rgba($color-brand, 0.16);
    }
  }
}

// ---- 进出场动画 ----
.bp-modal-enter-active,
.bp-modal-leave-active {
  transition: opacity $transition-base;
}

.bp-modal-enter-active .bp-modal__panel,
.bp-modal-leave-active .bp-modal__panel {
  transition: transform $transition-base;
}

.bp-modal-enter-from,
.bp-modal-leave-to {
  opacity: 0;
}

.bp-modal-enter-from .bp-modal__panel,
.bp-modal-leave-to .bp-modal__panel {
  transform: scale(0.95);
}
</style>
