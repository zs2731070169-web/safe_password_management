<script setup>
/**
 * FormField —— 通用文本输入字段
 *
 * 像素级还原 Figma 表单卡片中的单行输入（名称 / 账号 / 网址）。
 * 结构：标签（+ 可选必填星号）+ 输入框（浅蓝填充）+ 右侧图标插槽。
 */
defineProps({
  /** 字段标签 */
  label: {
    type: String,
    required: true
  },
  /** 受控值（v-model） */
  modelValue: {
    type: String,
    default: ''
  },
  /** 占位文案 */
  placeholder: {
    type: String,
    default: ''
  },
  /** 是否必填（标签后显示红色星号） */
  required: {
    type: Boolean,
    default: false
  },
  /** 输入类型 */
  type: {
    type: String,
    default: 'text'
  },
  /** 禁用态 */
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'submit'])

function onInput(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <div class="form-field">
    <label class="form-field__label">
      {{ label }}
      <span v-if="required" class="form-field__required">*</span>
    </label>

    <div class="form-field__control">
      <input
        class="form-field__input"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @input="onInput"
        @keydown.enter="emit('submit')"
      />
      <span v-if="$slots.icon" class="form-field__icon">
        <slot name="icon" />
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 标签与输入框 8px（设计 6px，取栅格 8）
  width: 100%;

  &__label {
    display: flex;
    align-items: center;
    gap: $spacing-xxs; // 文字与星号 4px
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-regular;
  }

  &__required {
    font-family: $font-family-mono;
    font-weight: $font-weight-bold;
    color: $color-danger;
  }

  // 输入框容器（相对定位以承载右侧图标）
  &__control {
    position: relative;
    width: 100%;
  }

  &__input {
    @include button-reset;
    width: 100%;
    height: 50px;
    padding: 0 44px 0 $spacing-sm + 1px; // 右留图标位 / 左 17px
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-md; // 12px
    font-size: $font-size-body; // 16px
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
  }

  // 右侧图标（绝对定位居中，纯展示）
  &__icon {
    @include flex-center;
    position: absolute;
    top: 50%;
    right: $spacing-sm;
    transform: translateY(-50%);
    color: $color-text-muted;
    pointer-events: none;
  }
}
</style>
