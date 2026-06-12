<script setup>
/**
 * 密码详情·顶部导航（uni-app 版）
 * 左侧返回 + 右侧「更新」文字按钮。
 * 像素级还原 Figma node 1:663「Header - Top App Bar」。
 *
 * 迁移要点（vue-router → uni）：
 *   - 去掉 useRouter，返回统一走 navBack()（uni 页面栈回退，触发 pop-out 右滑回过渡）；
 *   - 「更新」仍通过 emit('update') 上抛，由父级（详情页）决定跳转到编辑页。
 */
import { navBack } from '@/utils/navigation'
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 平台名（标题） */
  title: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update'])
</script>

<template>
  <view class="detail-header">
    <view class="detail-header__lead">
      <button
        type="button"
        class="detail-header__back"
        aria-label="返回"
        @click="navBack()"
      >
        <AppIcon name="arrow-left" :size="16" />
      </button>
    </view>

    <button type="button" class="detail-header__update" @click="emit('update')">
      更新
    </button>
  </view>
</template>

<style lang="scss" scoped>
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(#{$layout-header-height} + #{$safe-area-top});
  padding: #{$safe-area-top} $spacing-sm 0; // 避让刘海 / 状态栏
  background-color: $color-bg-header;

  &__lead {
    display: flex;
    align-items: center;
    gap: $spacing-sm;
    min-width: 0;
  }

  // 返回：圆形箭头按钮，与新增页 AddPasswordHeader 保持一致
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

  // 「更新」文字按钮
  &__update {
    @include button-reset;
    flex-shrink: 0;
    padding: $spacing-xs $spacing-sm;
    border-radius: $radius-sm;
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-brand;
    transition: background-color $transition-base;

    &:hover {
      background-color: rgba($color-brand, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }
}
</style>
