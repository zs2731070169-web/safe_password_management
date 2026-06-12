<script setup>
/**
 * 横向分类筛选 Chips（密码库主页私有子组件，uni-app 版）
 *
 * 胶囊按钮横向滚动：选中态品牌蓝实底白字，未选浅蓝底深灰字。
 * 还原 Figma node 1:970（Horizontal Category Chips，整行通栏可左右滑动）。
 *
 * uni 化要点：
 *   - 源工程用 DOM 指针拖拽（pointerdown/move + scroller.scrollLeft）模拟桌面拖动滚动，
 *     uni 的 <view> 无法直接读写 scrollLeft，改用原生横向滚动容器 <scroll-view scroll-x>，
 *     移动端原生触摸即可左右滑，桌面拖拽逻辑整体移除（H5 仍可用滚轮 / 触控板横向滚动）。
 *   - 嵌套在 home 外壳的 <swiper> 内：横向 scroll-view 会消费自身的横向滚动手势，
 *     swiper 让位、不误触发 Tab 翻页（仅当 chips 滚到边界时手势才回流给 swiper，可接受）。
 *   - 标签 button 保留（uni 内置）。
 */
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

/** 点击切换分类 */
function onSelect(key) {
  emit('change', key)
}
</script>

<template>
  <scroll-view
    scroll-x
    class="category-chips"
    :show-scrollbar="false"
  >
    <view class="category-chips__inner">
      <button
        v-for="item in categories"
        :key="item.key"
        type="button"
        class="category-chips__item"
        :class="{ 'category-chips__item--active': item.key === active }"
        @click="onSelect(item.key)"
      >
        {{ item.label }}
      </button>
    </view>
  </scroll-view>
</template>

<style lang="scss" scoped>
.category-chips {
  // 通栏：抵消页面左右内边距，实现整行贴边滑动
  flex-shrink: 0;
  margin: 0 (-$layout-page-padding);
  white-space: nowrap; // scroll-view 横向滚动需子项不换行

  // 内层 flex 行：横向排列 chips
  &__inner {
    display: inline-flex;
    flex-wrap: nowrap;
    gap: $spacing-xs;
    padding: 0 $layout-page-padding;
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
    transition:
      background-color $transition-base,
      color $transition-base;

    &--active {
      background-color: $color-brand;
      color: $color-white;
    }
  }
}
</style>
