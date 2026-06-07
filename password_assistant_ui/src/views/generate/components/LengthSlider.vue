<script setup>
/**
 * LengthSlider —— 密码长度滑块卡（密码生成器页私有子组件）
 *
 * 浅蓝卡片：左「长度」标签 + 右大号深蓝数字，下方滑块（轨道 + 圆形手柄）。
 * 基于原生 range input 自定义样式，保证无障碍（键盘可调）且像素级还原 Figma node 1:866。
 * 通过 v-model 双向绑定长度数值。
 */
import { computed } from 'vue'

const length = defineModel({ type: Number, required: true })

const props = defineProps({
  /** 最小长度 */
  min: {
    type: Number,
    default: 8
  },
  /** 最大长度 */
  max: {
    type: Number,
    default: 32
  }
})

/** 已填充进度百分比（用于轨道高亮渐变定位手柄左侧填充） */
const percent = computed(() => {
  const ratio = (length.value - props.min) / (props.max - props.min)
  return `${Math.min(100, Math.max(0, ratio * 100))}%`
})

/** range 原生事件：转数字写回 model */
function onInput(event) {
  length.value = Number(event.target.value)
}
</script>

<template>
  <div class="length-slider">
    <!-- 顶部：标签 + 当前长度大数字 -->
    <div class="length-slider__head">
      <span class="length-slider__label">长度</span>
      <span class="length-slider__value">{{ length }}</span>
    </div>

    <!-- 滑块：自定义样式的原生 range，轨道按进度填充 -->
    <div class="length-slider__track-wrap">
      <input
        class="length-slider__range"
        type="range"
        :min="min"
        :max="max"
        :value="length"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="length"
        aria-label="密码长度"
        :style="{ '--percent': percent }"
        @input="onInput"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.length-slider {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 12px 视觉，用 8 + 数字行高补足
  padding: $spacing-sm;
  background-color: $color-tile-blue; // #e7eefe
  border-radius: $radius-md;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: $font-size-list-title; // 17px
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__value {
    font-size: $font-size-display; // 32px
    font-weight: $font-weight-bold;
    line-height: $line-height-display;
    color: $color-link; // #004ac6
  }

  &__track-wrap {
    display: flex;
    align-items: center;
    height: 24px; // 容纳手柄
  }

  // 原生 range 自定义：轨道 8px、已填充段深蓝、手柄 24px 白描边圆
  &__range {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 8px;
    margin: 0;
    background: transparent;
    cursor: pointer;

    // —— 轨道（WebKit）：按 --percent 双色渐变实现已填充高亮 ——
    &::-webkit-slider-runnable-track {
      height: 8px;
      border-radius: $radius-pill;
      background: linear-gradient(
        to right,
        $color-link 0%,
        $color-link var(--percent),
        $color-track var(--percent),
        $color-track 100%
      );
    }

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 24px;
      height: 24px;
      margin-top: -8px; // (24-8)/2 居中于轨道
      border: 4px solid $color-white;
      border-radius: $radius-pill;
      background: $color-link;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    // —— 轨道（Firefox）——
    &::-moz-range-track {
      height: 8px;
      border-radius: $radius-pill;
      background: $color-track;
    }

    &::-moz-range-progress {
      height: 8px;
      border-radius: $radius-pill;
      background: $color-link;
    }

    &::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border: 4px solid $color-white;
      border-radius: $radius-pill;
      background: $color-link;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    &:focus-visible::-webkit-slider-thumb {
      outline: 2px solid rgba($color-brand, 0.5);
      outline-offset: 2px;
    }
  }
}
</style>
