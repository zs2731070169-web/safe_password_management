<script setup>
/**
 * SettingGroup —— 设置项分组容器（设置页私有子组件）
 *
 * 一组同类设置项的外壳：上方分组标题（如「安全」「数据」「显示」「关于」），
 * 下方白色圆角卡片承载若干 SettingItem，项间以浅描边分隔（由 SettingItem 自身处理）。
 * 还原 DRD 4.12 设置页的分组列表结构。
 */
defineProps({
  /** 分组标题文案 */
  title: {
    type: String,
    required: true
  }
})
</script>

<template>
  <section class="setting-group">
    <h2 class="setting-group__title">{{ title }}</h2>
    <div class="setting-group__card">
      <!-- 组内设置项（SettingItem / 自定义内容） -->
      <slot />
    </div>
  </section>
</template>

<style lang="scss" scoped>
.setting-group {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 标题与卡片间距 8px

  &__title {
    padding-left: $spacing-xxs; // 与卡片内容轻微对齐
    font-size: $font-size-section; // 13px 分组标题
    font-weight: $font-weight-bold;
    line-height: $line-height-section;
    letter-spacing: $letter-spacing-label;
    color: $color-text-muted;
  }

  // 分组卡片：白底圆角，承载多行设置项
  &__card {
    display: flex;
    flex-direction: column;
    background-color: $color-bg-card;
    border-radius: $radius-lg;
    box-shadow: $shadow-card;
    overflow: hidden; // 裁切首尾项圆角
  }
}
</style>
