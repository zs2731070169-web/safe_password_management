<script setup>
/**
 * 密码条目卡片（密码库主页私有子组件，uni-app 版）
 *
 * 左侧平台图标方块（首字母字标）+ 平台名 / 脱敏账号 / 掩码密码，右侧「复制」按钮。
 * 还原 Figma node 1:986（Card）。
 *
 * uni 化要点：
 *   - article/div→view，h3/p→text；脱敏与明文均为纯文本，包进 text。
 *   - 主体点击区去掉 Web 的 role/tabindex/@keydown.enter（uni 无键盘焦点语义）。
 *   - 主体点击区改用 <button>（button-reset 还原外观）而非 <view>：App 端实测此处
 *     <view @click> 不触发（同卡片内的 <button> 复制键正常），换原生 button 后点击可靠生效。
 *   - 脱敏开关逻辑（settings.maskAccount）完全沿用，仅影响展示，复制 / 打开仍用原始 entry。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import AppIcon from '@/components/icons/AppIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { maskAccountText } from '@/utils/maskAccount'

const props = defineProps({
  /** 条目数据：{ id, name, monogram, account, ... } */
  entry: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['copy', 'open'])

// 脱敏开关（settings.maskAccount）：开启时账号打码、密码显示实心圆圈；关闭时两者均显示真实明文。
const { maskAccount } = storeToRefs(useSettingsStore())
const displayAccount = computed(() =>
  maskAccount.value ? maskAccountText(props.entry.account) : props.entry.account
)
</script>

<template>
  <view class="password-card">
    <button type="button" class="password-card__main" hover-class="none" @click="emit('open', entry)">
      <!-- 平台图标方块（字标占位） -->
      <view class="password-card__tile">
        <text>{{ entry.monogram }}</text>
      </view>

      <view class="password-card__info">
        <text class="password-card__name">{{ entry.name }}</text>
        <text class="password-card__account">{{ displayAccount }}</text>
        <text
          class="password-card__secret"
          :class="{ 'password-card__secret--plain': !maskAccount }"
        >
          {{ maskAccount ? '●●●●●●●●' : entry.password }}
        </text>
      </view>
    </button>

    <!-- 复制按钮 -->
    <button type="button" class="password-card__copy" @click="emit('copy', entry)">
      <AppIcon name="copy" :size="16" />
      <text>复制</text>
    </button>
  </view>
</template>

<style lang="scss" scoped>
.password-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-sm;
  width: 100%;
  padding: $spacing-md - 1; // 17px，对齐 Figma
  background-color: $color-bg-card;
  border: 1px solid $color-border;
  border-radius: $radius-md;
  box-shadow: $shadow-shield;
  box-sizing: border-box;

  // 改为原生 button（App 端 view 点击不生效），button-reset 清掉默认外观后还原为可点的卡片主体
  &__main {
    @include button-reset;
    display: flex;
    align-items: center;
    gap: $spacing-sm;
    min-width: 0;
    flex: 1;
    text-align: left;
    border-radius: $radius-sm;
  }

  // 平台图标方块（字标）
  &__tile {
    @include flex-center;
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: $radius-sm;
    background-color: $color-brand-pale;
    font-size: $font-size-list-title;
    font-weight: $font-weight-bold;
    color: $color-brand;
  }

  &__info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  &__name {
    font-size: $font-size-list-title;
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
    @include text-ellipsis;
  }

  &__account {
    margin-top: 2px;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-muted;
    @include text-ellipsis;
  }

  &__secret {
    margin-top: 2px;
    font-size: 18px;
    line-height: 26px;
    letter-spacing: 0.9px;
    color: $color-text-muted;
    @include text-ellipsis;

    // 关闭脱敏时显示真实密码：改用可读的等宽小字号
    &--plain {
      font-size: $font-size-sm;
      line-height: $line-height-sm;
      letter-spacing: normal;
      font-family: $font-family-mono;
      color: $color-text-regular;
    }
  }

  // 复制按钮
  &__copy {
    @include button-reset;
    @include flex-center;
    flex-shrink: 0;
    gap: $spacing-xs;
    padding: $spacing-xs $spacing-sm;
    border-radius: $radius-sm;
    background-color: $color-brand-soft;
    font-size: $font-size-body;
    line-height: $line-height-body;
    color: $color-brand;
    transition: background-color $transition-base;

    &:active {
      background-color: rgba($color-brand, 0.16);
    }
  }
}
</style>
