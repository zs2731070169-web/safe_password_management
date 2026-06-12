<script setup>
/**
 * 账户密码输入框
 *
 * 浅蓝填充圆角输入框，左侧锁图标，右侧显示/隐藏密码切换按钮。
 * 通过 v-model 双向绑定密码，回车（@confirm）触发 submit 事件交由父级登录。
 */
import { ref } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const model = defineModel({ type: String, default: '' })

const emit = defineEmits({
  /** 在输入框内回车时触发，提交解锁 */
  submit: null
})

const props = defineProps({
  /** 解锁中禁用输入与切换 */
  disabled: {
    type: Boolean,
    default: false
  }
})

/** 是否以明文显示密码 */
const visible = ref(false)

/** 切换明文/密文 */
function toggleVisible() {
  if (props.disabled) return
  visible.value = !visible.value
}
</script>

<template>
  <view class="mp-input">
    <!-- 左侧锁图标 -->
    <AppIcon
      name="lock"
      :width="16"
      :height="21"
      class="mp-input__lock"
      aria-hidden="true"
    />

    <input
      v-model="model"
      :password="!visible"
      class="mp-input__field"
      placeholder="账户密码"
      :disabled="disabled"
      confirm-type="go"
      aria-label="账户密码"
      @confirm="emit('submit')"
    />

    <!-- 显示/隐藏密码切换 -->
    <button
      type="button"
      class="mp-input__toggle"
      :disabled="disabled"
      :aria-label="visible ? '隐藏密码' : '显示密码'"
      :aria-pressed="visible"
      @click="toggleVisible"
    >
      <AppIcon :name="visible ? 'eye' : 'eye-off'" :size="22" />
    </button>
  </view>
</template>

<style lang="scss" scoped>
.mp-input {
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

  // 左侧锁图标（绝对定位，居中对齐）
  &__lock {
    position: absolute;
    left: $spacing-sm;
    color: $color-text-muted;
    pointer-events: none;
  }

  // 输入区：左留锁图标位、右留切换按钮位
  &__field {
    @include button-reset;
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 48px; // 左右各避让 16px 图标 + 间距
    font-size: $font-size-input;
    line-height: $line-height-body;
    letter-spacing: $letter-spacing-input;
    color: $color-text-strong;
    cursor: text;

    &::placeholder {
      color: $color-text-muted;
      letter-spacing: $letter-spacing-input;
    }

    &:disabled {
      cursor: not-allowed;
    }
  }

  // 右侧显示/隐藏切换
  &__toggle {
    @include button-reset;
    @include flex-center;
    position: absolute;
    right: $spacing-sm;
    width: 28px;
    height: 28px;
    color: $color-text-muted;
    transition: color $transition-base;

    &:hover:not(:disabled) {
      color: $color-text-regular;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
      border-radius: $radius-sm;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }
}
</style>
