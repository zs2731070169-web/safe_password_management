<script setup>
/**
 * 修改账户密码·顶部导航（uni-app 版）
 * 左侧返回 + 标题「修改账户密码」，返回回退到设置页。
 * 结构与 ResetPasswordHeader 同构。
 *
 * 迁移要点（vue-router → uni）：
 *   - 去掉 useRouter，返回统一走 navBack()（uni 页面栈回退，触发 pop-out 右滑回过渡）；
 *   - 源 window.history.length 判定在 App 端不可靠，navBack 内部已对栈底做静默处理，故直接调用。
 */
import { navBack } from '@/utils/navigation'
import AppIcon from '@/components/icons/AppIcon.vue'
</script>

<template>
  <view class="cpw-header">
    <view class="cpw-header__lead">
      <button
        type="button"
        class="cpw-header__back"
        aria-label="返回"
        @click="navBack()"
      >
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <text class="cpw-header__title">修改账户密码</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.cpw-header {
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
}
</style>
