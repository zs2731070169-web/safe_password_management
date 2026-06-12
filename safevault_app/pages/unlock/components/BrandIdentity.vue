<script setup>
/**
 * 品牌识别区
 * 中央圆形盾牌徽标 + 主标题「密码管理小助手」+ 副标题「指纹一按，密码到手」。
 */
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  /** 是否展示指纹副标题提示（指纹登录可用时） */
  biometricLoginTip: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <view class="brand">
    <!-- 盾牌徽标 -->
    <view class="brand__shield">
      <AppIcon
        name="shield-solid"
        :width="38"
        :height="48"
        :color="'#ffffff'"
      />
    </view>

    <!-- 标题 -->
    <text class="brand__title">密码管理小助手</text>
    <text v-if="biometricLoginTip" class="brand__subtitle">指纹一按，密码到手</text>
  </view>
</template>

<style lang="scss" scoped>
.brand {
  @include flex-col-center;

  &__shield {
    position: relative;
    @include flex-center;
    @include circle(84px);
    margin-bottom: $spacing-xl; // 盾牌与标题间距 32px
    background-color: $color-brand-bright;
    box-shadow: $shadow-shield;
  }

  &__title {
    font-size: $font-size-title;
    font-weight: $font-weight-medium;
    line-height: $line-height-title;
    color: $color-text-strong;
    text-align: center;
  }

  &__subtitle {
    margin-top: $spacing-xs;
    font-size: $font-size-body;
    font-weight: $font-weight-regular;
    line-height: $line-height-body;
    color: $color-text-regular;
    text-align: center;
  }
}
</style>
