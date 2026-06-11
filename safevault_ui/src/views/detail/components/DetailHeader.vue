<script setup>
/**
 * 密码详情·顶部导航
 * 左侧返回 + 平台名标题，右侧「更新」文字按钮。
 * 像素级还原 Figma node 1:663「Header - Top App Bar」。
 */
import { useRouter } from 'vue-router'
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 平台名（标题） */
  title: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update'])

const router = useRouter()

/** 返回：有历史则后退，否则回密码库 */
function handleBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace({ name: 'Vault' })
  }
}
</script>

<template>
  <header class="detail-header">
    <div class="detail-header__lead">
      <button
        type="button"
        class="detail-header__back"
        aria-label="返回"
        @click="handleBack"
      >
        <AppIcon name="arrow-left" :size="16" />
      </button>
    </div>

    <button type="button" class="detail-header__update" @click="emit('update')">
      更新
    </button>
  </header>
</template>

<style lang="scss" scoped>
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(#{$layout-header-height} + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) $spacing-sm 0; // 避让刘海 / 状态栏
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
