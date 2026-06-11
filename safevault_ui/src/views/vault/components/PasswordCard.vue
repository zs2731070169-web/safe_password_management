<script setup>
/**
 * 密码条目卡片
 * 左侧平台图标方块（首字母字标）+ 平台名 / 脱敏账号 / 掩码密码，
 * 右侧「复制」按钮。还原 Figma node 1:986（Card）。
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
// 仅影响展示，复制 / 打开详情仍用原始 entry。
const { maskAccount } = storeToRefs(useSettingsStore())
const displayAccount = computed(() =>
  maskAccount.value ? maskAccountText(props.entry.account) : props.entry.account
)
</script>

<template>
  <article class="password-card">
    <div
      class="password-card__main"
      role="button"
      tabindex="0"
      :aria-label="`查看 ${entry.name} 详情`"
      @click="emit('open', entry)"
      @keydown.enter="emit('open', entry)"
    >
      <!-- 平台图标方块（字标占位） -->
      <div class="password-card__tile" aria-hidden="true">
        {{ entry.monogram }}
      </div>

      <div class="password-card__info">
        <h3 class="password-card__name">{{ entry.name }}</h3>
        <p class="password-card__account">{{ displayAccount }}</p>
        <p
          class="password-card__secret"
          :class="{ 'password-card__secret--plain': !maskAccount }"
          :aria-label="maskAccount ? '密码已隐藏' : '密码明文'"
        >
          {{ maskAccount ? '●●●●●●●●' : entry.password }}
        </p>
      </div>
    </div>

    <!-- 复制按钮 -->
    <button type="button" class="password-card__copy" @click="emit('copy', entry)">
      <AppIcon name="copy" :size="16" />
      <span>复制</span>
    </button>
  </article>
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

  &__main {
    display: flex;
    align-items: center;
    gap: $spacing-sm;
    min-width: 0;
    flex: 1;
    cursor: pointer;
    border-radius: $radius-sm;

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
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

    &:hover {
      background-color: $color-brand-pale;
    }

    &:active {
      background-color: rgba($color-brand, 0.16);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }
}
</style>
