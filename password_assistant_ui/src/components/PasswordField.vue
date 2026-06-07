<script setup>
/**
 * PasswordField —— 带显隐切换的密码输入字段
 *
 * 像素级还原 Figma node 1:282 / 1:303。
 * 结构：标签 + 输入框（浅蓝填充 + 右侧眼睛切换密文/明文）+ 可选错误提示。
 * 可选开启 allowGenerate：输入框右侧再添一个「一键生成」按钮，点击触发 generate 事件，
 * 由上层调用生成器填值（用于修改主密码等需要自动生成强密码的场景）。
 */
import { ref } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
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
  /** 错误态：红框 + 错误文案 */
  error: {
    type: Boolean,
    default: false
  },
  /** 错误文案 */
  errorText: {
    type: String,
    default: ''
  },
  /** 禁用态 */
  disabled: {
    type: Boolean,
    default: false
  },
  /** 是否在输入框右侧显示「一键生成」按钮（点击触发 generate 事件，由上层填值） */
  allowGenerate: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'submit', 'generate'])

/** 是否明文显示 */
const visible = ref(false)

function onInput(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <div class="pw-field" :class="{ 'pw-field--error': error }">
    <label class="pw-field__label">{{ label }}</label>

    <div class="pw-field__control">
      <input
        class="pw-field__input"
        :class="{ 'pw-field__input--with-gen': allowGenerate }"
        :type="visible ? 'text' : 'password'"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="new-password"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @input="onInput"
        @keydown.enter="emit('submit')"
      />
      <div class="pw-field__actions">
        <button
          type="button"
          class="pw-field__toggle"
          :aria-label="visible ? '隐藏密码' : '显示密码'"
          @click="visible = !visible"
        >
          <AppIcon :name="visible ? 'eye' : 'eye-off'" :size="20" />
        </button>
        <button
          v-if="allowGenerate"
          type="button"
          class="pw-field__gen"
          aria-label="一键生成密码"
          :disabled="disabled"
          @click="emit('generate')"
        >
          <AppIcon name="refresh" :size="16" />
        </button>
      </div>
    </div>

    <p v-if="error && errorText" class="pw-field__error">{{ errorText }}</p>
  </div>
</template>

<style lang="scss" scoped>
.pw-field {
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

  // 输入框容器（相对定位以承载眼睛按钮）
  &__control {
    position: relative;
    width: 100%;
  }

  &__input {
    @include button-reset;
    width: 100%;
    height: 56px;
    padding: 0 49px 0 $spacing-sm + 1px; // 右留眼睛位 / 左 17px
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-sm; // 8px
    font-size: $font-size-input; // 18px
    letter-spacing: $letter-spacing-input;
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

  // 开启一键生成时，输入框右侧需容纳「眼睛 + 生成」两个按钮
  &__input--with-gen {
    padding-right: 86px;
  }

  // 右侧按钮组（绝对定位右侧居中，承载眼睛 / 生成）
  &__actions {
    position: absolute;
    top: 50%;
    right: $spacing-sm;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: $spacing-xxs; // 4px
  }

  // 显隐切换按钮
  &__toggle {
    @include button-reset;
    @include flex-center;
    color: $color-text-muted;
    transition: color $transition-base;

    &:hover {
      color: $color-text-regular;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
      border-radius: $radius-sm;
    }
  }

  // 一键生成按钮：浅蓝底 + 主题色图标（与新增页生成按钮同语义）
  &__gen {
    @include button-reset;
    @include flex-center;
    width: 36px;
    height: 36px;
    border-radius: $radius-sm;
    background-color: rgba($color-link, 0.1);
    color: $color-link;
    transition:
      background-color $transition-base,
      color $transition-base;

    &:hover:not(:disabled) {
      background-color: rgba($color-link, 0.16);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 1px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }

  &__error {
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-danger;
  }

  // 错误态：红框
  &--error .pw-field__input {
    border-color: $color-danger;

    &:focus {
      box-shadow: 0 0 0 3px rgba($color-danger, 0.12);
    }
  }
}
</style>
