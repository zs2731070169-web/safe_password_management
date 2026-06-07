<script setup>
/**
 * 悬浮新增按钮（FAB）
 * 品牌蓝圆角方形，居中加号，浮于底部导航之上。
 * 还原 Figma node 1:1054（Button - FAB）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'

const emit = defineEmits(['click'])
</script>

<template>
  <button type="button" class="add-fab" aria-label="新增密码" @click="emit('click')">
    <AppIcon name="plus" :width="17.5" :height="17.5" :color="'#ffffff'" />
  </button>
</template>

<style lang="scss" scoped>
.add-fab {
  @include button-reset;
  @include flex-center;
  width: $size-fab;
  height: $size-fab;
  border-radius: $radius-lg;
  background-color: $color-brand;
  box-shadow: $shadow-fab-neutral;
  transition:
    transform $transition-fast,
    background-color $transition-base;

  &:hover {
    background-color: $color-brand-bright;
  }

  &:active {
    transform: scale(0.94);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.35);
    outline-offset: 2px;
  }
}
</style>
