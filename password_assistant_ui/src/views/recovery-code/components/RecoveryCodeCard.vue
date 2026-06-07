<script setup>
/**
 * RecoveryCodeCard —— 恢复码展示卡
 *
 * 像素级还原 Figma node 1:26：白底 + 2px 描边 + 大圆角的等宽恢复码框，
 * 分组以浅色连字符分隔。生成中显示占位骨架。
 */
import { computed } from 'vue'

const props = defineProps({
  /** 恢复码（格式 XXXXX-XXXXX-XXXXX-XXXXX-XXXXX） */
  code: {
    type: String,
    default: ''
  },
  /** 生成中（显示占位） */
  loading: {
    type: Boolean,
    default: false
  }
})

/** 拆分为分组，供分隔符插入 */
const groups = computed(() => (props.code ? props.code.split('-') : []))
</script>

<template>
  <div class="rc-card" role="group" aria-label="账户恢复码">
    <div class="rc-card__inner">
      <!-- 生成中：占位骨架 -->
      <template v-if="loading || !groups.length">
        <span class="rc-card__placeholder">生成中…</span>
      </template>
      <!-- 恢复码分组（连字符浅色分隔；窄屏自动换行，避免裁切） -->
      <template v-else>
        <span v-for="(group, index) in groups" :key="index" class="rc-card__chunk">
          <span class="rc-card__group">{{ group }}</span>
          <span v-if="index < groups.length - 1" class="rc-card__sep" aria-hidden="true">-</span>
        </span>
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.rc-card {
  width: 100%;
  padding: 26px $spacing-md; // 上下 26 / 左右 18（Figma 1:26）
  background-color: $color-bg-card;
  border: 2px solid $color-border;
  border-radius: $radius-lg;
  box-shadow: $shadow-shield;

  // 内容行：等宽、居中；窄屏自动换行，保证恢复码完整可见、不被裁切
  &__inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    column-gap: $spacing-xxs; // 4px
    row-gap: $spacing-xxs; // 换行时的行距
  }

  // 「分组 + 连字符」作为不换行单元，避免连字符落到行首被拆散
  &__chunk {
    display: inline-flex;
    align-items: center;
    column-gap: $spacing-xxs; // 4px
    white-space: nowrap;
  }

  &__group {
    font-family: $font-family-mono;
    font-size: $font-size-section; // 13px
    font-weight: $font-weight-medium;
    line-height: 26px;
    letter-spacing: $letter-spacing-code; // 1.8px
    color: $color-text-regular;
    text-transform: uppercase;
    white-space: nowrap;
  }

  // 连字符：更浅、更大，作视觉分隔
  &__sep {
    font-family: $font-family-mono;
    font-size: $font-size-input; // 18px
    line-height: 26px;
    color: $color-border;
    user-select: none;
  }

  &__placeholder {
    font-family: $font-family-mono;
    font-size: $font-size-section; // 13px
    line-height: 26px;
    letter-spacing: $letter-spacing-code;
    color: $color-text-placeholder;
  }
}
</style>
