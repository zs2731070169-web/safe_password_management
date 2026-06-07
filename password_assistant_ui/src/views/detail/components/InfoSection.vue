<script setup>
/**
 * InfoSection —— 详情页 Bento 信息卡通用外壳
 *
 * 白底卡片 + 顶部等宽大写标签（label）+ 可选右上角插槽（图标/状态）+ 主体内容插槽。
 * 还原 Figma node 1:607 / 1:621 / 1:629 / 1:646 的统一卡片样式。
 */
defineProps({
  /** 字段标签（如 ACCOUNT / PASSWORD / URL / CATEGORY） */
  label: {
    type: String,
    required: true
  }
})
</script>

<template>
  <section class="info-section">
    <div class="info-section__head">
      <span class="info-section__label">{{ label }}</span>
      <slot name="head-right" />
    </div>
    <div class="info-section__body">
      <slot />
    </div>
  </section>
</template>

<style lang="scss" scoped>
.info-section {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 标签与内容 8px
  width: 100%;
  padding: $spacing-lg - 3px; // 21px，对齐 Figma
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 16px;
  }

  &__label {
    font-family: $font-family-mono;
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-bold;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-label;
    text-transform: uppercase;
    color: $color-text-muted;
  }

  &__body {
    width: 100%;
  }
}
</style>
