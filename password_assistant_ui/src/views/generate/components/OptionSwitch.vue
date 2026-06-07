<script setup>
/**
 * OptionSwitch —— 字符集开关项（密码生成器页私有子组件）
 *
 * 单行：左侧图标 + 文案，右侧胶囊开关（toggle）。
 * 整行可点击切换，开关本身用原生 checkbox 承载语义以保证无障碍与键盘可达。
 * 像素级还原 Figma node 1:877 等开关行（含开 / 关两态配色）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'

/** 开关状态（双向绑定） */
const checked = defineModel({ type: Boolean, default: false })

defineProps({
  /** 行首图标名（AppIcon 注册名） */
  icon: {
    type: String,
    required: true
  },
  /** 文案 */
  label: {
    type: String,
    required: true
  }
})

/** 切换开关 */
function toggle() {
  checked.value = !checked.value
}
</script>

<template>
  <label class="option-switch" :class="{ 'option-switch--on': checked }">
    <span class="option-switch__lead">
      <AppIcon :name="icon" :size="20" class="option-switch__icon" />
      <span class="option-switch__label">{{ label }}</span>
    </span>

    <!-- 原生 checkbox 隐藏，承载选中语义；视觉由 ::after 手柄表现 -->
    <input
      class="option-switch__input"
      type="checkbox"
      :checked="checked"
      @change="toggle"
    />
    <span class="option-switch__track" aria-hidden="true">
      <span class="option-switch__thumb"></span>
    </span>
  </label>
</template>

<style lang="scss" scoped>
.option-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-sm;
  min-height: 58px;
  padding: 17px;
  background-color: $color-bg-input; // #f0f3ff
  border-radius: $radius-md;
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color $transition-base;

  &:focus-within {
    border-color: rgba($color-brand, 0.4);
  }

  // —— 左侧：图标 + 文案 ——
  &__lead {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  &__icon {
    flex-shrink: 0;
    color: $color-text-muted;
  }

  &__label {
    @include text-ellipsis;
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  // —— 右侧：胶囊开关 ——
  // 真正的 checkbox 隐藏，仅用于无障碍 / 键盘聚焦
  &__input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  &__track {
    position: relative;
    flex-shrink: 0;
    width: 44px;
    height: 24px;
    border-radius: $radius-pill;
    background-color: $color-border; // 关：#c3c6d7
    transition: background-color $transition-base;
  }

  &__thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: $radius-pill;
    background-color: $color-white;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    transition: transform $transition-base;
  }

  // —— 开态 ——
  &--on {
    .option-switch__track {
      background-color: $color-link; // 开：#004ac6
    }

    .option-switch__thumb {
      transform: translateX(20px); // 44 - 2*2 - 20 = 20
    }
  }

  &__input:focus-visible + .option-switch__track {
    outline: 2px solid rgba($color-brand, 0.5);
    outline-offset: 2px;
  }
}
</style>
