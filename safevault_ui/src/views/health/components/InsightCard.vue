<script setup>
/**
 * 安全建议卡（虚线装饰卡）
 * 闪光图标 +「安全建议」标题 + 建议正文。还原 Figma node 1:539（Decorative Insight Card）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 建议项：{ name, type, icon } —— name 作标题，type 作正文 */
  insight: {
    type: Object,
    required: true
  }
})
</script>

<template>
  <section class="insight-card">
    <div class="insight-card__head">
      <AppIcon :name="insight.icon || 'sparkles'" :size="22" />
      <h3 class="insight-card__title">{{ insight.name }}</h3>
    </div>
    <p class="insight-card__body">{{ insight.type }}</p>
  </section>
</template>

<style lang="scss" scoped>
.insight-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  padding: $spacing-lg - 2; // 22px，对齐 Figma
  background-color: rgba($color-brand, 0.1);
  border: 2px dashed rgba($color-brand, 0.3);
  border-radius: $radius-lg;

  &__head {
    display: flex;
    align-items: center;
    gap: 12px;
    color: $color-link;
  }

  &__title {
    font-size: $font-size-list-title;
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-link;
  }

  &__body {
    font-size: $font-size-sm;
    line-height: 22.75px; // Figma 段落行高
    color: $color-text-regular;
  }
}
</style>
