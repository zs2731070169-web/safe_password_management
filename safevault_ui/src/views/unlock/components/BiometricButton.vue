<script setup>
/**
 * BiometricButton —— 生物识别（指纹）解锁按钮
 *
 * 88dp 圆形主操作，承载页面核心交互。
 * loading 时指纹呼吸闪烁并禁用，避免重复触发。
 *
 * @emits trigger 用户点击触发解锁
 */
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  /** 是否处于解锁中（loading） */
  loading: {
    type: Boolean,
    default: false
  },
  /** 是否禁用 */
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['trigger'])

function handleClick() {
  if (props.loading || props.disabled) return
  emit('trigger')
}
</script>

<template>
  <button
    type="button"
    class="biometric-btn"
    :class="{ 'is-loading': loading }"
    :disabled="disabled"
    :aria-busy="loading"
    aria-label="使用指纹解锁"
    @click="handleClick"
  >
    <AppIcon
      class="biometric-btn__icon"
      name="fingerprint"
      :width="30.082"
      :height="33.274"
      :color="'#ffffff'"
    />
  </button>
</template>

<style lang="scss" scoped>
.biometric-btn {
  @include button-reset;
  @include flex-center;
  @include circle($size-biometric); // 88px
  background-color: $color-brand;
  box-shadow: $shadow-biometric;
  transition:
    transform $transition-fast,
    box-shadow $transition-fast,
    opacity $transition-fast;

  // 按压反馈
  &:active:not(:disabled) {
    transform: scale(0.94);
  }

  // 键盘聚焦可见焦点环（无障碍）
  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.4);
    outline-offset: 3px;
  }

  &:disabled {
    cursor: not-allowed;
  }

  // 解锁中：指纹呼吸动画
  &.is-loading {
    cursor: progress;

    .biometric-btn__icon {
      animation: biometric-pulse 1s ease-in-out infinite;
    }
  }

  &__icon {
    display: block;
  }
}

@keyframes biometric-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
</style>
