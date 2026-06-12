<script setup>
/**
 * GeneratePasswordField —— 新增密码页·密码字段（uni-app 版）
 *
 * 像素级还原 Figma node 1:376「Password with Strength Meter」。
 * 结构：
 *   1. 标签行：左「密码 *」、右强度文案
 *   2. 等宽输入框 + 右侧「显隐 / 一键生成」两个按钮
 *   3. 「密码强度」标签 + 单条强度进度条（按强度比例 + 红绿灯配色）
 *
 * 强度评估规则统一来自 utils/passwordStrength，与重设主密码、健康检测共用一套。
 *
 * 迁移要点（HTML input → uni input）：
 *   - 密文显隐 :type="visible?'text':'password'" → :password="!visible"（uni 用 password 属性）；
 *   - 取值 @input 取 e.detail.value；回车 @keydown.enter → @confirm；
 *   - 移除 autocomplete / autocapitalize / autocorrect / spellcheck；
 *   - 源 ::placeholder 改字体在 uni input 无效，改用 placeholder-style 内联指定（常规字体、正常字距）。
 */
import { ref, computed } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { evaluatePasswordLevel, STRENGTH_LEVEL_TEXT } from '@/utils/passwordStrength'

const props = defineProps({
  /** 受控值（v-model） */
  modelValue: {
    type: String,
    default: ''
  },
  /** 禁用态 */
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'generate', 'submit'])

/** 是否明文显示 */
const visible = ref(false)

function onInput(event) {
  emit('update:modelValue', event.detail?.value ?? event.target?.value ?? '')
}

/**
 * 评估密码强度
 * @returns {{ level: number, text: string }} level 0~4
 */
const strength = computed(() => {
  const level = evaluatePasswordLevel(props.modelValue)
  // 空密码（level 0）在本场景不展示文案
  return { level, text: level ? STRENGTH_LEVEL_TEXT[level] : '' }
})

/** 进度条填充宽度（按等级 25% 步进） */
const fillWidth = computed(() => `${strength.value.level * 25}%`)

/** 等级配色修饰类 */
const levelClass = computed(() => `is-level-${strength.value.level}`)
</script>

<template>
  <view class="gen-field" :class="levelClass">
    <!-- 标签行：左标签 / 右强度文案 -->
    <view class="gen-field__head">
      <view class="gen-field__label">
        <text>密码</text>
        <text class="gen-field__required">*</text>
      </view>
      <text v-if="strength.text" class="gen-field__status">{{ strength.text }}</text>
    </view>

    <!-- 输入框 + 右侧按钮 -->
    <view class="gen-field__control">
      <input
        class="gen-field__input"
        :password="!visible"
        :value="modelValue"
        placeholder="输入或生成密码"
        placeholder-style="font-family: -apple-system, sans-serif; letter-spacing: normal; color: #9aa3b2;"
        :disabled="disabled"
        @input="onInput"
        @confirm="emit('submit')"
      />
      <view class="gen-field__actions">
        <button
          type="button"
          class="gen-field__btn"
          :aria-label="visible ? '隐藏密码' : '显示密码'"
          @click="visible = !visible"
        >
          <AppIcon :name="visible ? 'eye' : 'eye-off'" :size="20" />
        </button>
        <button
          type="button"
          class="gen-field__btn gen-field__btn--accent"
          aria-label="生成密码"
          :disabled="disabled"
          @click="emit('generate')"
        >
          <AppIcon name="refresh" :size="16" />
        </button>
      </view>
    </view>

    <!-- 强度行：左侧「密码强度」标签 + 右侧进度条 -->
    <view class="gen-field__meter-row">
      <text class="gen-field__meter-label">密码强度</text>
      <view class="gen-field__meter">
        <view class="gen-field__meter-fill" :style="{ width: fillWidth }"></view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.gen-field {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 各部分 8px（设计 5.5~6px，取栅格 8）
  width: 100%;

  // 标签行
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    display: flex;
    align-items: center;
    gap: $spacing-xxs; // 4px
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

  // 强度文案（默认弱化色，按等级覆盖）
  &__status {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-muted;
  }

  // 输入框容器
  &__control {
    position: relative;
    width: 100%;
  }

  &__input {
    @include button-reset;
    width: 100%;
    height: 56px;
    padding: 0 92px 0 $spacing-sm + 1px; // 右留两个按钮位 / 左 17px
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-md; // 12px
    font-family: $font-family-mono; // 等宽
    font-size: $font-size-input; // 18px
    letter-spacing: $letter-spacing-value; // 0.9px
    color: $color-text-strong;
    cursor: text;
    transition:
      border-color $transition-base,
      box-shadow $transition-base;

    &:focus {
      border-color: $color-brand;
      box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  // 右侧按钮组
  &__actions {
    position: absolute;
    top: 50%;
    right: $spacing-xs; // 8px
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: $spacing-xxs; // 4px
  }

  &__btn {
    @include button-reset;
    @include flex-center;
    width: 36px;
    height: 36px;
    border-radius: $radius-sm;
    color: $color-text-muted;
    transition:
      background-color $transition-base,
      color $transition-base;

    &:hover:not(:disabled) {
      color: $color-text-regular;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 1px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    // 生成按钮：浅蓝底 + 主题色图标
    &--accent {
      background-color: rgba($color-link, 0.1);
      color: $color-link;

      &:hover:not(:disabled) {
        background-color: rgba($color-link, 0.16);
        color: $color-link;
      }
    }
  }

  // 强度行：左标签 + 进度条
  &__meter-row {
    display: flex;
    align-items: center;
    gap: $spacing-xs; // 8px
    width: 100%;
  }

  // 「密码强度」标签
  &__meter-label {
    flex-shrink: 0;
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-muted;
    white-space: nowrap;
  }

  // 强度进度条
  &__meter {
    flex: 1;
    min-width: 0;
    height: 6px;
    background-color: $color-brand-pale;
    border-radius: $radius-pill;
    overflow: hidden;
  }

  &__meter-fill {
    display: block;
    height: 100%;
    background-color: $color-border;
    border-radius: $radius-pill;
    transition:
      width $transition-base,
      background-color $transition-base;
  }

  // ---- 等级配色 ----
  &.is-level-1 {
    .gen-field__status { color: $color-danger; }
    .gen-field__meter-fill { background-color: $color-danger; }
  }

  &.is-level-2 {
    .gen-field__status { color: $color-warning; }
    .gen-field__meter-fill { background-color: $color-warning; }
  }

  &.is-level-3,
  &.is-level-4 {
    .gen-field__status { color: $color-success-strong; }
    .gen-field__meter-fill { background-color: $color-success-strong; }
  }
}
</style>
