<script setup>
/**
 * 重置密码·顶部导航（uni-app 版）
 * 左侧返回 + 标题（左对齐紧挨），右侧盾牌图标。
 */
import AppIcon from '@/components/icons/AppIcon.vue'
import { navReplace, navBack } from '@/utils/navigation'

/** 返回：有上层页则后退，否则重定向回登录页 */
function handleBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    navBack()
  } else {
    navReplace('Unlock')
  }
}
</script>

<template>
  <view class="reset-header">
    <view class="reset-header__lead">
      <button
        type="button"
        class="reset-header__back"
        aria-label="返回"
        @click="handleBack"
      >
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <text class="reset-header__title">重置密码</text>
    </view>
    <AppIcon name="shield" :width="16" :height="20" class="reset-header__shield" />
  </view>
</template>

<style lang="scss" scoped>
.reset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(#{$layout-header-height} + #{$safe-area-top});
  padding: #{$safe-area-top} $spacing-sm 0; // 避让刘海 / 状态栏
  background-color: $color-bg-header;

  // 左侧：返回 + 标题（gap 16）
  &__lead {
    display: flex;
    align-items: center;
    gap: $spacing-sm;
  }

  &__back {
    @include button-reset;
    @include flex-center;
    color: $color-brand;
    transition: opacity $transition-base;

    &:hover {
      opacity: 0.75;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
      border-radius: $radius-sm;
    }
  }

  &__title {
    font-size: $font-size-logo; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-logo;
    color: $color-brand;
    white-space: nowrap;
  }

  // 右侧盾牌（线性，深色）
  &__shield {
    color: $color-text-strong;
  }
}
</style>
