<script setup>
/**
 * CloudAccountCard —— 设置页顶部云账户卡片
 *
 * 统一身份后，设置页顶部展示当前云账户：已登录显示脱敏邮箱 + 「已登录」标记，
 * 未登录显示「未登录」。卡片视觉沿用 AboutCard（白底 + 圆角 + 轻投影）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps({
  /** 是否已登录云账户 */
  loggedIn: {
    type: Boolean,
    default: false
  },
  /** 脱敏后的账户邮箱（已登录时展示） */
  email: {
    type: String,
    default: ''
  }
})
</script>

<template>
  <section class="account-card">
    <span class="account-card__avatar" aria-hidden="true">
      <AppIcon name="person" :width="22" :height="22" :color="'#ffffff'" />
    </span>

    <span class="account-card__info">
      <span class="account-card__name">{{ loggedIn ? (email || '云账户') : '未登录' }}</span>
      <!-- 副标题：已登录展示「云账户」，未登录展示引导文案 -->
      <span class="account-card__sub">
        {{ loggedIn ? '云账户' : '尚未登录云账户' }}
      </span>
    </span>

    <span v-if="loggedIn" class="account-card__status">
      <AppIcon name="shield-check" :width="12" :height="15" />
      <span>已登录</span>
    </span>
  </section>
</template>

<style lang="scss" scoped>
.account-card {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  padding: $spacing-sm;
  background-color: $color-bg-card;
  border-radius: $radius-lg;
  box-shadow: $shadow-card;

  // 头像方块（品牌底白图标）
  &__avatar {
    @include flex-center;
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: $radius-pill;
    background-color: $color-brand;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  &__name {
    @include text-ellipsis;
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    color: $color-text-strong;
  }

  &__sub {
    @include text-ellipsis;
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-text-muted;
  }

  // 已登录标记（绿底胶囊）
  &__status {
    display: flex;
    align-items: center;
    gap: $spacing-xxs; // 4px
    flex-shrink: 0;
    padding: 4px 8px;
    border-radius: $radius-pill;
    background-color: $color-health-glow;
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-health-text;
  }
}
</style>
