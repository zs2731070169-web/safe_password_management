<script setup>
/**
 * AppIcon —— 通用图标组件
 *
 * 统一渲染 icon-paths 注册表中的矢量图标，颜色默认使用 currentColor，
 * 由父级文字颜色（color）控制，便于主题与状态透传。
 *
 * @example
 * <AppIcon name="fingerprint" :size="30" color="#fff" />
 */
import { computed } from 'vue'
import { ICON_PATHS } from './icon-paths'

const props = defineProps({
  /** 图标名称，需存在于 icon-paths 注册表 */
  name: {
    type: String,
    required: true,
    validator: (val) => Object.prototype.hasOwnProperty.call(ICON_PATHS, val)
  },
  /** 图标尺寸（数字按 px，字符串原样输出） */
  size: {
    type: [Number, String],
    default: 24
  },
  /** 宽度，传入则覆盖 size（用于非正方形图标） */
  width: {
    type: [Number, String],
    default: null
  },
  /** 高度，传入则覆盖 size（用于非正方形图标） */
  height: {
    type: [Number, String],
    default: null
  },
  /** 填充色，默认跟随文字颜色 */
  color: {
    type: String,
    default: 'currentColor'
  }
})

// 解析当前图标定义
const icon = computed(() => ICON_PATHS[props.name] ?? { viewBox: '0 0 24 24', paths: [] })

// 计算最终宽高，支持非正方形
const resolvedWidth = computed(() => normalizeSize(props.width ?? props.size))
const resolvedHeight = computed(() => normalizeSize(props.height ?? props.size))

function normalizeSize(val) {
  return typeof val === 'number' ? `${val}px` : val
}
</script>

<template>
  <svg
    class="app-icon"
    :viewBox="icon.viewBox"
    :width="resolvedWidth"
    :height="resolvedHeight"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-for="(d, index) in icon.paths"
      :key="index"
      :d="d"
      :fill="color"
    />
  </svg>
</template>

<style lang="scss" scoped>
.app-icon {
  display: block;
  flex-shrink: 0;
}
</style>
