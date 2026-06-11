<script setup>
/**
 * 新增密码·Hero 装饰区
 * 蓝底卡片：中央白色盾牌 + 文案「密码管理小助手 · 安全加密」，
 * 背景叠加一层低透明度白色方块网格（旋转 12°）作氛围装饰。
 * 像素级还原 Figma node 1:341「Hero Decorative Section」。
 */
import AppIcon from '@/components/icons/AppIcon.vue'
</script>

<template>
  <div class="add-hero">
    <!-- 背景装饰方块网格（旋转 12°，低透明度） -->
    <div class="add-hero__deco" aria-hidden="true">
      <span v-for="i in 6" :key="i" class="add-hero__block"></span>
    </div>

    <!-- 中央内容 -->
    <div class="add-hero__content">
      <AppIcon
        name="shield-solid"
        :width="24"
        :height="30"
        :color="'#ffffff'"
        class="add-hero__shield"
      />
      <p class="add-hero__tagline">密码管理小助手 · 安全加密</p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.add-hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 128px;
  border-radius: $radius-md; // 12px
  // 品牌蓝斜向渐变（亮 → 深，全用 Token），还原原设计稿的层次感，取代低分辨率位图
  background: linear-gradient(135deg, $color-brand 0%, $color-link 100%);
  overflow: hidden;

  // 背景方块网格层
  &__deco {
    position: absolute;
    inset: -40px -60px;
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: $spacing-xs; // 8px
    opacity: 0.1;
    transform: rotate(12deg);
    pointer-events: none;
  }

  &__block {
    height: 80px;
    background-color: $color-white;
    border-radius: $radius-sm; // 8px
  }

  // 中央内容
  &__content {
    @include flex-col-center;
    position: relative;
    z-index: $z-content;
    gap: $spacing-xs; // 盾牌与文案 8px
  }

  &__shield {
    filter: drop-shadow($shadow-shield);
  }

  &__tagline {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    text-transform: uppercase;
    color: $color-on-brand;
    white-space: nowrap;
  }
}
</style>
