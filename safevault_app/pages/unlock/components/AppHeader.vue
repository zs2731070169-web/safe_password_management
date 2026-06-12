<script setup>
/**
 * 解锁页顶部品牌导航（unlock 私有，区别于全局 @/components/AppHeader.vue）
 * 左侧盾牌图标 + SafeVault 文字 Logo（英文使用 Inter 体）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'
</script>

<template>
  <view class="unlock-header">
    <view class="unlock-header__brand">
      <AppIcon
        name="shield"
        :width="13.333"
        :height="16.667"
        :color="'#004ac6'"
      />
      <text class="unlock-header__title">密码安全助手</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.unlock-header {
  display: flex;
  align-items: center;
  height: calc(#{$layout-header-height} + #{$safe-area-top});
  padding: #{$safe-area-top} $spacing-sm 0; // 避让刘海/状态栏
  background-color: $color-bg-header;

  &__brand {
    display: flex;
    align-items: center;
    gap: $spacing-xs;
  }

  &__title {
    font-size: $font-size-logo;
    font-weight: $font-weight-bold;
    line-height: $line-height-logo;
    color: $color-brand;
    white-space: nowrap;
  }
}
</style>
