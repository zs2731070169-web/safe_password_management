<script setup>
/**
 * 品牌识别区
 * 中央 128px 圆形盾牌徽标 + 主标题「密码管理小助手」+ 副标题「指纹一按，密码到手」。
 *
 * 盾牌徽标由两层矢量叠加而成：
 *  - shield-solid：深蓝实心盾牌外形
 *  - shield-lock ：内部浅色锁孔，居中叠加于盾牌之上
 */
import AppIcon from '@/components/icons/AppIcon.vue'
</script>

<template>
  <section class="brand">
    <!-- 盾牌徽标 -->
    <div class="brand__shield">
      <AppIcon
        class="brand__shield-base"
        name="shield-solid"
        :width="38"
        :height="55"
        :color="'#ffffff'"
      />
    </div>

    <!-- 标题 -->
    <h1 class="brand__title">密码管理小助手</h1>
    <p class="brand__subtitle">指纹一按，密码到手</p>
  </section>
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

  // 锁孔叠加：以盾牌中心为基准微调，匹配设计稿位置
  &__shield-lock {
    position: absolute;
    top: calc(50% + 5px);
    left: 50%;
    transform: translate(-50%, -50%);
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
