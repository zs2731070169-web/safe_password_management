<script setup>
/**
 * RecoveryCodeInput —— 恢复码分段输入框
 *
 * 像素级还原 Figma node 2:61「Multi-input field for recovery code segments」。
 * 左侧 KEY 标签 + 右侧等宽输入：自动转大写、过滤非字母数字、每 5 位插入连字符，
 * 最终格式 XXXXX-XXXXX-XXXXX-XXXXX-XXXXX（共 25 位有效字符）。
 */
const props = defineProps({
  /** 受控值（已格式化） */
  modelValue: {
    type: String,
    default: ''
  },
  /** 错误态：描边变红 */
  error: {
    type: Boolean,
    default: false
  },
  /** 禁用态 */
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'submit'])

/** 5 段 × 每段 5 位 = 25 位有效字符 */
const SEGMENTS = 5
const SEGMENT_LEN = 5
const MAX_CLEAN = SEGMENTS * SEGMENT_LEN // 25
const MAX_DISPLAY = MAX_CLEAN + SEGMENTS - 1 // 25 + 4 个连字符 = 29

/**
 * 规整原始输入为分段格式
 * @param {string} raw - 用户原始输入
 * @returns {string} XXXXX-XXXXX-… 形式
 */
function format(raw) {
  const clean = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_CLEAN)
  return clean.match(/.{1,5}/g)?.join('-') ?? ''
}

function onInput(event) {
  const formatted = format(event.target.value)
  // 强制回写，保证显示与受控值一致（自动补/去连字符）
  event.target.value = formatted
  emit('update:modelValue', formatted)
}

function onKeydown(event) {
  if (event.key === 'Enter') emit('submit')
}
</script>

<template>
  <div class="rc-input" :class="{ 'rc-input--error': error }">
    <span class="rc-input__key">KEY</span>
    <input
      class="rc-input__field"
      type="text"
      inputmode="text"
      autocapitalize="characters"
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
      :value="modelValue"
      :disabled="disabled"
      :maxlength="MAX_DISPLAY"
      placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
      @input="onInput"
      @keydown="onKeydown"
    />
  </div>
</template>

<style lang="scss" scoped>
.rc-input {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 13px; // Figma node 2:61
  background-color: $color-bg-card;
  border: 1px solid $color-border;
  border-radius: $radius-md;
  transition:
    border-color $transition-base,
    box-shadow $transition-base;

  &:focus-within {
    border-color: $color-brand;
    box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
  }

  // 错误态：红色描边（来自 useRecovery.errorMsg）
  &--error {
    border-color: $color-danger;

    &:focus-within {
      box-shadow: 0 0 0 3px rgba($color-danger, 0.12);
    }
  }

  // KEY 标签
  &__key {
    flex-shrink: 0;
    padding-right: $spacing-2xs; // 12px
    font-family: $font-family-mono;
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-bold;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-muted;
  }

  // 等宽输入
  &__field {
    @include button-reset;
    flex: 1;
    min-width: 0;
    padding: 0 $spacing-2xs; // 12px 内边距
    font-family: $font-family-mono;
    font-size: $font-size-input; // 18px
    font-weight: $font-weight-medium;
    letter-spacing: $letter-spacing-code;
    color: $color-text-strong;
    cursor: text;

    &::placeholder {
      color: $color-border;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }
}
</style>
