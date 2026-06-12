<script setup>
/**
 * 底部信任徽章
 * 胶囊形浅蓝底 + 绿色锁图标 + 「数据已本地加密」，传递安全感。
 */
import AppIcon from '@/components/icons/AppIcon.vue'
</script>

<template>
  <view class="trust-badge" role="note">
    <AppIcon
      name="lock"
      :width="9.333"
      :height="12.25"
      :color="'#006e2d'"
    />
    <text class="trust-badge__text">数据已本地加密</text>
  </view>
</template>

<style lang="scss" scoped>
.trust-badge {
  display: inline-flex;
  align-items: center;
  gap: $spacing-xs;
  padding: $spacing-xs $spacing-sm;
  border-radius: $radius-pill;
  background-color: $color-brand-pale;

  &__text {
    font-size: $font-size-caption;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-regular;
    white-space: nowrap;
  }
}
</style>
