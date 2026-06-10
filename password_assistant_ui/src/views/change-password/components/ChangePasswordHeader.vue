<script setup>
/**
 * 修改账户密码·顶部导航
 * 左侧返回 + 标题「修改账户密码」，右侧盾牌图标。
 * 结构与 ResetPasswordHeader 同构，返回回退到设置页。
 */
import { useRouter } from 'vue-router'
import AppIcon from '@/components/icons/AppIcon.vue'

const router = useRouter()

/** 返回：有历史则后退，否则回到设置 Tab */
function handleBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace({ name: 'Settings' })
  }
}
</script>

<template>
  <header class="cpw-header">
    <div class="cpw-header__lead">
      <button
        type="button"
        class="cpw-header__back"
        aria-label="返回"
        @click="handleBack"
      >
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <h1 class="cpw-header__title">修改账户密码</h1>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.cpw-header {
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
}
</style>
