<script setup>
/**
 * AppIcon —— 通用图标组件
 *
 * 统一渲染 icon-paths 注册表中的矢量图标，颜色默认使用 currentColor，
 * 由父级文字颜色（color）控制，便于主题与状态透传。
 *
 * 渲染方式：用 CSS mask 而非 inline <svg>。
 * 原因：uni-app 的 app-vue 编译器把 <svg>/<path> 当未知标签处理，会丢失
 * :viewBox/:d/:fill 等属性绑定，导致 App 端图标整体不渲染（H5 因浏览器原生
 * 支持 svg 正常）。改用 <view> + CSS mask：把 icon-paths 的 path 拼成
 * data:image/svg+xml 作 mask 取「形状」，颜色由元素 background-color 提供。
 * 这样 currentColor 走 background-color 天然跟随父级文字色（tab 选中变色等
 * 照常工作），形状与颜色解耦，App + H5 两端一致渲染。
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

// 把当前图标拼成 data:image/svg+xml，用作 CSS mask（只取形状的 alpha，fill 用纯黑占位）。
// 属性统一双引号 + 整体 encodeURIComponent，自动处理 # / < / 空格 / " 等字符。
const maskUri = computed(() => {
  const body = icon.value.paths.map((d) => `<path d="${d}" fill="#000"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.value.viewBox}">${body}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})

// 行内样式：尺寸 + 颜色（background-color 跟随 currentColor / 显式色）+ mask 图形
const iconStyle = computed(() => ({
  width: resolvedWidth.value,
  height: resolvedHeight.value,
  backgroundColor: props.color,
  WebkitMaskImage: `url("${maskUri.value}")`,
  maskImage: `url("${maskUri.value}")`
}))
</script>

<template>
  <view class="app-icon" :style="iconStyle" />
</template>

<style lang="scss" scoped>
.app-icon {
  display: block;
  flex-shrink: 0;
  // 形状走行内 mask-image，定位 / 平铺 / 缩放固定：居中、不平铺、等比 contain
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
</style>
