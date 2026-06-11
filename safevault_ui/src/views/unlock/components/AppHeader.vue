<script setup>
/**
 * 解锁页顶部品牌导航
 * 左侧盾牌图标 + SafeVault 文字 Logo（英文使用 Inter 体）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'
</script>

<template>
  <header class="unlock-header">
    <div class="unlock-header__brand">
      <AppIcon
        name="shield"
        :width="13.333"
        :height="16.667"
        :color="'#004ac6'"
      />
      <span class="unlock-header__title">密码安全助手</span>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.unlock-header {
  display: flex;
  align-items: center;
  height: calc(#{$layout-header-height} + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) $spacing-sm 0; // 避让刘海/状态栏
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
