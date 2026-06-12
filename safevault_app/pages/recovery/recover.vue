<script setup>
/**
 * 数据待恢复·再入口（独立右侧弹出 SHEET 页）—— uni-app 版
 *
 * 入口：设置页「数据待恢复」条目（仅 cloudAccount.pendingRecovery 为真时出现）。重置密码后若用户
 * 在重置流程里跳过了恢复步骤，会落入「无 DataKey → 云备份/同步静默失效」的死状态且原先无路可退；
 * 本页提供正式再入口，复用 RecoverDataStep：输入恢复码恢复，或无恢复码时「放弃旧数据并重建」。
 *
 * 完成（恢复成功 / 重建完成，RecoverDataStep emit('done')）即返回设置页。
 * 沿用项目「自右弹出 sheet」模式（header + 左滑返回手势 useSheetDismiss）。
 *
 * —— 自源 views/recovery/RecoverDataView.vue 迁移 ——
 *   - vue-router(router.back/replace) → navBack；
 *   - 标签 div/header/main/h1/span → view/text；
 *   - RecoverDataStep 已迁至同级 components/，相对路径引用；
 *   - 触摸事件去掉 .passive 修饰符（uni 不识别）。
 */
import AppIcon from '@/components/icons/AppIcon.vue'
import RecoverDataStep from './components/RecoverDataStep.vue'
import { useSheetDismiss } from '@/composables/useSheetDismiss'
import { navBack } from '@/utils/navigation'

/** 返回设置页（uni 页面栈回退，触发 pop-out 右滑回过渡） */
function handleBack() {
  navBack()
}

/** 恢复 / 重建完成：返回设置页（RecoverDataStep 内部已处理反馈与新恢复码展示） */
function onDone() {
  handleBack()
}

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回
const { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useSheetDismiss({
  onDismiss: handleBack
})
</script>

<template>
  <view
    class="recover-page"
    ref="sheetRoot"
    :style="sheetStyle"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <!-- 顶部导航 -->
    <view class="recover-header">
      <button type="button" class="recover-header__back" aria-label="返回" @click="handleBack">
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <text class="recover-header__title">恢复数据</text>
      <view class="recover-header__placeholder" aria-hidden="true"></view>
    </view>

    <view class="recover-page__main">
      <RecoverDataStep @done="onDone" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.recover-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: $color-bg-page;
  overflow: hidden;

  &__main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
  }
}

// ---- 顶部导航（与重新生成恢复码页同构）----
.recover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-xs;
  height: calc(#{$layout-header-height} + #{$safe-area-top});
  padding: #{$safe-area-top} $spacing-sm 0;
  background-color: $color-bg-header;

  &__back {
    @include button-reset;
    @include flex-center;
    @include circle($size-touch-min);
    flex-shrink: 0;
    color: $color-link;
    transition: background-color $transition-base;

    &:hover {
      background-color: rgba($color-link, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-link, 0.4);
      outline-offset: 2px;
    }
  }

  &__title {
    flex: 1;
    text-align: center;
    font-size: $font-size-list-title; // 15px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__placeholder {
    flex-shrink: 0;
    width: $size-touch-min;
  }
}
</style>
