<script setup>
/**
 * AppTabBar —— 全局底部主导航（BottomNavBar）
 *
 * 四个 Tab：库 / 健康 / 生成 / 设置；选中态为亮蓝圆角实底白字。
 * 跨页复用组件（密码库主页、健康度页等共用），通过 active 指明当前页、
 * change 事件交由各页处理路由跳转。还原 Figma node 1:1072 / 1:448。
 */
import AppIcon from '@/components/icons/AppIcon.vue'
import { TABS as tabs } from '@/constants/tabs'

defineProps({
  /** 当前激活的 tab key */
  active: {
    type: String,
    default: 'vault'
  }
})

const emit = defineEmits(['change'])

// Tab 定义统一取自 constants/tabs（与滑动翻页 / 过渡方向共用同一数据源）
</script>

<template>
  <view class="tab-bar" aria-label="主导航">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="tab-bar__item"
      :class="{ 'tab-bar__item--active': tab.key === active }"
      :aria-current="tab.key === active ? 'page' : undefined"
      @click="emit('change', tab.key)"
    >
      <AppIcon :name="tab.icon" :size="22" />
      <text class="tab-bar__label">{{ tab.label }}</text>
    </button>
  </view>
</template>

<style lang="scss" scoped>
.tab-bar {
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: calc(#{$layout-tabbar-height + 6px} + env(safe-area-inset-bottom)); // 70px + Home 条
  padding: 9px $spacing-sm calc(8px + env(safe-area-inset-bottom));
  background-color: $color-tile-blue; // #e7eefe
  border-top: 1px solid $color-border;

  &__item {
    @include button-reset;
    @include flex-col-center;
    justify-content: center;
    gap: 4px;
    padding: 6px 12px;
    border-radius: $radius-md;
    color: $color-text-regular;
    transition:
      background-color $transition-base,
      color $transition-base;

    &--active {
      background-color: $color-brand-bright;
      color: $color-on-brand;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }

  &__label {
    font-size: $font-size-caption;
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
  }
}
</style>
