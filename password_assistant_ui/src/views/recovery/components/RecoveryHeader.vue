<script setup>
/**
 * 找回访问权限·顶部导航
 * 左侧返回按钮 + 居中标题（品牌蓝）。多步流程复用。
 * 像素级还原 Figma node 2:80「Top Navigation Header」。
 */
import { useRouter } from 'vue-router'
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 标题文案 */
  title: {
    type: String,
    default: '找回访问权限'
  }
})

const router = useRouter()

/** 返回：有历史则后退，否则回到主密码解锁页 */
function handleBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace({ name: 'MasterPassword' })
  }
}
</script>

<template>
  <header class="recovery-header">
    <button
      type="button"
      class="recovery-header__back"
      aria-label="返回"
      @click="handleBack"
    >
      <AppIcon name="arrow-left" :size="16" />
    </button>
    <h1 class="recovery-header__title">{{ title }}</h1>
  </header>
</template>

<style lang="scss" scoped>
.recovery-header {
  position: relative;
  @include flex-center;
  height: calc(#{$layout-header-height} + env(safe-area-inset-top));
  padding-top: env(safe-area-inset-top); // 避让刘海 / 状态栏
  background-color: $color-bg-header;

  // 返回按钮：圆形命中区，左对齐
  &__back {
    @include button-reset;
    @include flex-center;
    @include circle(40px);
    position: absolute;
    left: $spacing-sm;
    bottom: 12px; // 与设计稿 Button-返回 的位置对齐
    color: $color-brand;
    transition: background-color $transition-base;

    &:hover {
      background-color: rgba($color-brand, 0.06);
    }

    &:active {
      background-color: rgba($color-brand, 0.1);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
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
