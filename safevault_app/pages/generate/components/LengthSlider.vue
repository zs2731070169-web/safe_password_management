<script setup>
/**
 * LengthSlider —— 密码长度滑块卡（密码生成器页私有子组件，uni-app 版）
 *
 * 浅蓝卡片：左「长度」标签 + 右大号深蓝数字，下方滑块（轨道 + 圆形手柄）。
 * 还原 Figma node 1:866。通过 v-model 双向绑定长度数值。
 *
 * uni 化要点（核心难点：原生 range → uni slider）：
 *   - 源工程基于 <input type="range"> + ::-webkit-slider-thumb / ::-moz-range-* 伪元素自绘
 *     轨道与手柄；uni 无这些伪元素，改用内置 <slider> 组件还原视觉：
 *       · activeColor=已填充段深蓝（$color-link），backgroundColor=未填充浅灰轨道（$color-track）；
 *       · block-color=手柄填充色，block-size=手柄直径（uni slider 手柄为实心圆，无白描边，
 *         用品牌深蓝实心手柄近似还原，视觉差异可接受）。
 *   - 取值：拖动中 @changing（实时刷新数字），松手 @change（最终写回）；均取 e.detail.value。
 *   - 颜色属性需走 JS 常量传入（uni slider 的 color 属性只认 prop，不吃 CSS），故从 Token 取色值。
 */
import { ref } from 'vue'

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

/**
 * uni <slider> 的轨道 / 手柄颜色只接受 prop（不吃 scoped CSS），
 * 故在此以常量提供，与 styles/variables.scss 的 Token 取值保持一致：
 *   - $color-link  #004ac6（已填充段 + 手柄）
 *   - $color-track 未填充轨道浅灰
 * 若后续 Token 调色，这里需同步（已在注释标注来源，避免「魔法值」失联）。
 */
const ACTIVE_COLOR = '#004ac6' // = $color-link：已填充段深蓝
const TRACK_COLOR = '#d9deef' // = $color-track：未填充轨道浅灰
const BLOCK_COLOR = '#004ac6' // = $color-link：手柄填充

/** 拖动中实时分数（@changing），用于数字即时跟手 */
const dragging = ref(length.value)

/** 拖动过程：实时刷新展示数字（不写 model，避免高频写 store） */
function onChanging(e) {
  dragging.value = Number(e.detail.value)
}

/** 松手：最终值写回 model（store 夹紧 + 自动持久化） */
function onChange(e) {
  const val = Number(e.detail.value)
  dragging.value = val
  length.value = val
}
</script>

<template>
  <view class="length-slider">
    <!-- 顶部：标签 + 当前长度大数字（拖动中跟随 dragging，松手与 model 一致） -->
    <view class="length-slider__head">
      <text class="length-slider__label">长度</text>
      <text class="length-slider__value">{{ dragging }}</text>
    </view>

    <!-- 滑块：uni 内置 slider，颜色 / 手柄经 prop 还原设计 -->
    <view class="length-slider__track-wrap">
      <slider
        class="length-slider__range"
        :value="length"
        :min="min"
        :max="max"
        :step="1"
        :block-size="24"
        :activeColor="ACTIVE_COLOR"
        :backgroundColor="TRACK_COLOR"
        :block-color="BLOCK_COLOR"
        @changing="onChanging"
        @change="onChange"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.length-slider {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
  padding: $spacing-sm;
  background-color: $color-tile-blue; // #e7eefe
  border-radius: $radius-md;
  box-sizing: border-box;

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
    min-height: 24px; // 容纳手柄
  }

  // uni slider：占满宽度，去除组件默认外边距
  &__range {
    width: 100%;
    margin: 0;
  }
}
</style>
