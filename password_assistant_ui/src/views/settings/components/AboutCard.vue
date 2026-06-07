<script setup>
/**
 * AboutCard —— 关于区卡片（设置页私有子组件）
 *
 * 上方信任徽章「本地加密 · 不上云 · 核心开源」（绿盾，建立信任，对齐 DRD 4.12 / 信任透明原则），
 * 下方三条跳转行（隐私政策 / 开源仓库 / 版本号）。
 * 跳转行点击交由父级占位提示（本版本未接真实页面 / 外链）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 版本号文案（如 v1.0） */
  version: {
    type: String,
    default: 'v1.0'
  }
})

const emit = defineEmits(['activate'])

/** 关于区跳转行（版本行展示版本号、无跳转语义） */
const LINKS = [
  { key: 'privacy', label: '隐私政策', navigable: true }
]
</script>

<template>
  <section class="about-card">
    <!-- 信任徽章 -->
    <div class="about-card__badge">
      <span class="about-card__shield" aria-hidden="true">
        <AppIcon name="shield-check" :width="16" :height="20" />
      </span>
      <span class="about-card__badge-text">本地加密</span>
    </div>

    <!-- 跳转行 + 版本行 -->
    <div class="about-card__links">
      <button
        v-for="link in LINKS"
        :key="link.key"
        type="button"
        class="about-card__row"
        @click="emit('activate', link.label)"
      >
        <span class="about-card__row-label">{{ link.label }}</span>
        <AppIcon name="chevron-right" :size="20" class="about-card__row-arrow" />
      </button>

      <!-- 版本号：纯展示，无跳转 -->
      <div class="about-card__row about-card__row--static">
        <span class="about-card__row-label">版本</span>
        <span class="about-card__version">{{ version }}</span>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.about-card {
  display: flex;
  flex-direction: column;
  background-color: $color-bg-card;
  border-radius: $radius-lg;
  box-shadow: $shadow-card;
  overflow: hidden;

  // —— 信任徽章 ——
  &__badge {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: $spacing-sm;
    background-color: $color-health-glow; // 极淡绿底，呼应「健康 / 安全」
  }

  &__shield {
    @include flex-center;
    flex-shrink: 0;
    width: $size-setting-icon-tile; // 36px
    height: $size-setting-icon-tile;
    border-radius: $radius-sm;
    background-color: $color-health-bg; // #7cf994
    color: $color-health-text; // #007230
  }

  &__badge-text {
    font-size: $font-size-sm; // 14px
    font-weight: $font-weight-medium;
    line-height: $line-height-sm;
    color: $color-success-strong;
  }

  // —— 跳转 / 版本行 ——
  &__links {
    display: flex;
    flex-direction: column;
  }

  &__row {
    @include button-reset;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $spacing-sm;
    width: 100%;
    min-height: $size-setting-row; // 56px
    padding: $spacing-2xs $spacing-sm;
    text-align: left;
    border-top: 1px solid rgba($line-base, 0.4);
    cursor: pointer;
    transition: background-color $transition-fast;

    &:hover {
      background-color: rgba($color-brand, 0.03);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: -2px;
    }

    // 版本行：纯展示，去交互态
    &--static {
      cursor: default;

      &:hover {
        background-color: transparent;
      }
    }
  }

  &__row-label {
    font-size: $font-size-body; // 16px
    line-height: $line-height-body;
    color: $color-text-strong;
  }

  &__row-arrow {
    flex-shrink: 0;
    color: $color-text-placeholder;
  }

  &__version {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-muted;
  }
}
</style>
