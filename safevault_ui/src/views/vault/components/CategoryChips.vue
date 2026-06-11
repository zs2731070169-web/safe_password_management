<script setup>
/**
 * 横向分类筛选 Chips
 * 胶囊按钮横向滚动，选中态为品牌蓝实底白字，未选为浅蓝底深灰字。
 * 还原 Figma node 1:970（Horizontal Category Chips，整行通栏可左右滑动）。
 *
 * 滑动：移动端原生触摸滚动；桌面端补充「指针拖拽滚动」，鼠标也能左右拖动。
 */
import { ref } from 'vue'

defineProps({
  /** 分类列表：[{ key, label }] */
  categories: {
    type: Array,
    required: true
  },
  /** 当前选中分类 key */
  active: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['change'])

const scroller = ref(null)
// 拖拽滚动状态
let dragging = false
let moved = false
let startX = 0
let startScrollLeft = 0

function onPointerDown(e) {
  // 仅响应主键 / 触摸 / 笔
  if (e.button !== undefined && e.button !== 0) return
  dragging = true
  moved = false
  startX = e.clientX
  startScrollLeft = scroller.value.scrollLeft
}

function onPointerMove(e) {
  if (!dragging) return
  const delta = e.clientX - startX
  if (Math.abs(delta) > 4) moved = true
  scroller.value.scrollLeft = startScrollLeft - delta
}

function onPointerUp() {
  dragging = false
}

/** 点击切换：若刚发生拖拽则忽略，避免拖动误触选中 */
function onSelect(key) {
  if (moved) return
  emit('change', key)
}
</script>

<template>
  <div
    ref="scroller"
    class="category-chips"
    role="tablist"
    aria-label="密码分类"
    data-swipe-ignore
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <button
      v-for="item in categories"
      :key="item.key"
      type="button"
      role="tab"
      :aria-selected="item.key === active"
      class="category-chips__item"
      :class="{ 'category-chips__item--active': item.key === active }"
      @click="onSelect(item.key)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style lang="scss" scoped>
.category-chips {
  display: flex;
  flex-wrap: nowrap;
  flex-shrink: 0; // 作为滚动容器，避免在父级弹性列中被压缩为 0 高度
  gap: $spacing-xs;
  // 通栏：抵消页面左右内边距，实现整行贴边滑动
  margin: 0 (-$layout-page-padding);
  padding: 0 $layout-page-padding;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;
  cursor: grab;
  // 隐藏滚动条，保留滑动
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }

  &:active {
    cursor: grabbing;
  }

  &__item {
    @include button-reset;
    flex-shrink: 0;
    padding: $spacing-xs 20px;
    border-radius: $radius-pill;
    background-color: $color-brand-pale;
    font-size: $font-size-body;
    line-height: $line-height-body;
    color: $color-text-regular;
    white-space: nowrap;
    user-select: none;
    transition:
      background-color $transition-base,
      color $transition-base;

    &--active {
      background-color: $color-brand;
      color: $color-white;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }
}
</style>
