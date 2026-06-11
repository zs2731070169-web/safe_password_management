<script setup>
/**
 * 重置密码·顶部导航
 * 左侧返回 + 标题（左对齐紧挨），右侧盾牌图标。
 */
import { useRouter } from 'vue-router'
import AppIcon from '@/components/icons/AppIcon.vue'

const router = useRouter()

/** 返回：有历史则后退，否则回到登录页 */
function handleBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace({ name: 'Unlock' })
  }
}
</script>

<template>
  <header class="reset-header">
    <div class="reset-header__lead">
      <button
        type="button"
        class="reset-header__back"
        aria-label="返回"
        @click="handleBack"
      >
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <h1 class="reset-header__title">重置密码</h1>
    </div>
    <AppIcon name="shield" :width="16" :height="20" class="reset-header__shield" />
  </header>
</template>

<style lang="scss" scoped>
.reset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(#{$layout-header-height} + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) $spacing-sm 0; // 避让刘海 / 状态栏
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
