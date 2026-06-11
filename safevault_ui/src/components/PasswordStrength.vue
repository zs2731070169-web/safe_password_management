<script setup>
/**
 * PasswordStrength —— 密码强度计
 *
 * 像素级还原 Figma node 1:292。
 * 根据密码长度与字符种类评估为 0~4 级，展示状态文案 + 4 段进度条。
 * 强度语义沿用设计系统「红绿灯」：弱(红) / 中(橙棕) / 强·很强(绿)。
 */
import { computed } from 'vue'
import { evaluatePasswordLevel, STRENGTH_LEVEL_TEXT } from '@/utils/passwordStrength'

const props = defineProps({
  /** 待评估的密码 */
  password: {
    type: String,
    default: ''
  }
})

/** 段总数 */
const SEGMENTS = 4

/**
 * 评估密码强度（规则统一来自 utils/passwordStrength，与新增页、健康检测共用一套）
 * @returns {{ level: number, text: string }} level 0~4
 */
const strength = computed(() => {
  const level = evaluatePasswordLevel(props.password)
  // 空密码（level 0）在本场景展示「等待输入」
  return { level, text: level ? STRENGTH_LEVEL_TEXT[level] : '等待输入' }
})

/** 等级对应的配色修饰类 */
const levelClass = computed(() => `is-level-${strength.value.level}`)
</script>

<template>
  <div class="pw-strength" :class="levelClass">
    <div class="pw-strength__head">
      <span class="pw-strength__label">密码强度</span>
      <span class="pw-strength__status">{{ strength.text }}</span>
    </div>
    <div class="pw-strength__track">
      <span
        v-for="i in SEGMENTS"
        :key="i"
        class="pw-strength__seg"
        :class="{ 'is-active': i <= strength.level }"
      ></span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.pw-strength {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 8px
  width: 100%;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-regular;
  }

  // 状态文案默认弱化色，按等级覆盖
  &__status {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-muted;
  }

  // 进度条槽
  &__track {
    display: flex;
    gap: $spacing-xxs; // 4px 段间距
    height: 6px;
    padding: 0;
    background-color: $color-brand-pale;
    border-radius: $radius-pill;
    overflow: hidden;
  }

  // 单段：默认灰，激活后由等级色覆盖
  &__seg {
    flex: 1;
    min-width: 0;
    height: 100%;
    background-color: $color-border;
    transition: background-color $transition-base;
  }

  // ---- 等级配色 ----
  &.is-level-1 {
    .pw-strength__status { color: $color-danger; }
    .pw-strength__seg.is-active { background-color: $color-danger; }
  }

  &.is-level-2 {
    .pw-strength__status { color: $color-warning; }
    .pw-strength__seg.is-active { background-color: $color-warning; }
  }

  &.is-level-3,
  &.is-level-4 {
    .pw-strength__status { color: $color-success-strong; }
    .pw-strength__seg.is-active { background-color: $color-success-strong; }
  }
}
</style>
