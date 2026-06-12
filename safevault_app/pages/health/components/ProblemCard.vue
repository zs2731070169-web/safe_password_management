<script setup>
/**
 * 问题卡（不对称现代卡片，密码健康度页私有子组件，uni-app 版）
 *
 * 左侧圆形图标底（按严重度分色）+ 平台名 / 问题类型 + 右上严重度标签 + 右下「立即修改」。
 * 还原 Figma node 1:503 / 1:521（Problem Item）。
 * uni 化：article/div→view，h3/p/span→text；严重度配色类 --weak/--dup/--medium 保留。
 */
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 问题项：{ id, name, type, severity, tag, icon } */
  entry: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['fix'])
</script>

<template>
  <view class="problem-card" :class="`problem-card--${entry.severity}`">
    <!-- 图标圆底（严重度分色） -->
    <view class="problem-card__badge">
      <AppIcon :name="entry.icon" :width="16" :height="20" />
    </view>

    <view class="problem-card__body">
      <!-- 上行：名称/类型 + 严重度标签 -->
      <view class="problem-card__top">
        <view class="problem-card__meta">
          <text class="problem-card__name">{{ entry.name }}</text>
          <text class="problem-card__type">{{ entry.type }}</text>
        </view>
        <text class="problem-card__tag">{{ entry.tag }}</text>
      </view>

      <!-- 下行：立即修改 -->
      <view class="problem-card__actions">
        <button
          type="button"
          class="problem-card__fix"
          @click="emit('fix', entry)"
        >
          <text>立即修改</text>
          <AppIcon name="arrow-right" :size="10" />
        </button>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.problem-card {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  width: 100%;
  padding: $spacing-md - 1; // 17px，对齐 Figma
  background-color: $color-bg-card;
  border: 1px solid $color-border;
  border-radius: $radius-md;
  box-shadow: $shadow-shield;
  box-sizing: border-box;

  // 图标圆底（48px）；底色与图标色由严重度修饰类提供
  &__badge {
    @include flex-center;
    flex-shrink: 0;
    @include circle(48px);
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: $spacing-2xs; // 12px
    flex: 1;
    min-width: 0;
  }

  &__top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: $spacing-xs;
  }

  &__meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  &__name {
    font-size: $font-size-list-title;
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__type {
    margin-top: 0;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-muted;
  }

  // 严重度胶囊标签
  &__tag {
    flex-shrink: 0;
    padding: 2px $spacing-xs;
    border-radius: $radius-pill;
    font-size: $font-size-micro;
    font-weight: $font-weight-bold;
    line-height: $line-height-micro;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
  }

  // 立即修改链接
  &__fix {
    @include button-reset;
    display: inline-flex;
    align-items: center;
    gap: $spacing-xxs;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-link;
    border-radius: $radius-sm;
    transition: opacity $transition-base;
  }

  // —— 严重度配色 ——
  // 弱（红）：图标底 / 标签底取危险浅底，图标 / 标签文字取危险色
  &--weak {
    .problem-card__badge {
      background-color: $color-danger-soft;
      color: $color-danger;
    }

    .problem-card__tag {
      background-color: $color-danger-soft;
      color: $color-danger;
    }
  }

  // 重复 / 中等强度（橙，同色系）：图标底 / 标签底取警告容器底，图标 / 标签文字取警告色
  &--dup,
  &--medium {
    .problem-card__badge {
      background-color: $color-warning-container;
      color: $color-warning;
    }

    .problem-card__tag {
      background-color: $color-warning-container;
      color: $color-warning;
    }
  }
}
</style>
