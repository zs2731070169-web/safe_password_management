<script setup>
/**
 * OptionSwitch —— 字符集开关项（密码生成器页私有子组件，uni-app 版）
 *
 * 单行：左侧图标 + 文案，右侧胶囊开关（toggle）。整行可点击切换。
 * 像素级还原 Figma node 1:877 等开关行（含开 / 关两态配色）。
 *
 * uni 化要点（规则手册第二节）：
 *   - 源工程用隐藏的原生 <input type="checkbox"> 承载语义 + CSS 视觉；uni 无原生 checkbox，
 *     去掉隐藏 input，改由根容器 @click 切换 model；开态由 :class（--on）驱动 track/thumb 视觉。
 *   - label→view（uni 无 label 语义需求）；原 :checked 相关焦点选择器一并移除（无隐藏 input）。
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

/** 切换开关（整行点击） */
function toggle() {
  checked.value = !checked.value
}
</script>

<template>
  <view class="option-switch" :class="{ 'option-switch--on': checked }" @click="toggle">
    <view class="option-switch__lead">
      <AppIcon :name="icon" :size="20" class="option-switch__icon" />
      <text class="option-switch__label">{{ label }}</text>
    </view>

    <!-- 胶囊开关：开态由 --on 类驱动 track 变色 + thumb 平移（不再依赖隐藏 input） -->
    <view class="option-switch__track">
      <view class="option-switch__thumb"></view>
    </view>
  </view>
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
  box-sizing: border-box;
  transition: border-color $transition-base;

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
}
</style>
