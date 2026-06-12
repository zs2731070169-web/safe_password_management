<script setup>
/**
 * 新增 / 编辑密码·顶部导航（uni-app 版）
 * 左侧返回 + 标题（左对齐紧挨）。标题由父级传入：新增「新增密码」/ 编辑「编辑密码」。
 * 像素级还原 Figma node 1:428「Header - TopAppBar」。
 *
 * 迁移要点（vue-router → uni）：去掉 useRouter，返回统一走 navBack()
 * （uni 页面栈回退，触发 pop-out 右滑回过渡）。
 */
import { navBack } from '@/utils/navigation'
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 顶栏标题 */
  title: {
    type: String,
    default: '新增密码'
  }
})
</script>

<template>
  <view class="add-header">
    <button
      type="button"
      class="add-header__back"
      aria-label="返回"
      @click="navBack()"
    >
      <AppIcon name="arrow-left" :size="16" />
    </button>
    <text class="add-header__title">{{ title }}</text>
  </view>
</template>

<style lang="scss" scoped>
.add-header {
  display: flex;
  align-items: center;
  gap: $spacing-2xs; // 返回与标题 12px
  height: calc(#{$layout-header-height} + #{$safe-area-top});
  padding: #{$safe-area-top} $spacing-sm 0; // 避让刘海 / 状态栏
  background-color: $color-bg-header;

  &__back {
    @include button-reset;
    @include flex-center;
    @include circle($size-touch-min);
    flex-shrink: 0;
    color: $color-link;
    transition:
      background-color $transition-base,
      opacity $transition-base;

    &:hover {
      background-color: rgba($color-link, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-link, 0.4);
      outline-offset: 2px;
    }
  }

  &__title {
    font-size: $font-size-logo; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-logo;
    color: $color-link;
    white-space: nowrap;
  }
}
</style>
