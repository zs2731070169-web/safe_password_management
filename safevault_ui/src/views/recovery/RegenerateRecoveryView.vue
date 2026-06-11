<script setup>
/**
 * RegenerateRecoveryView —— 重新生成恢复码（独立右侧弹出页）
 *
 * 入口：设置「安全 → 恢复码」。身份验证已在设置页前置完成（useSettings.requireIdentity），
 * 进入本页即用会话 DataKey 以新恢复码重新包裹上传 recovery-blob（store.regenerateRecoveryCode，
 * 密钥逻辑已就绪，本页只编排），旧恢复码随即失效，再复用 RecoveryCodeReveal 展示 + 保存 + 确认。
 *
 * 边界：
 *   - 生成中：展示 loading 占位；
 *   - 无会话 DataKey（regenerate 返回 null，理论上已登录持有，属异常）：提示并返回设置页；
 *   - 网络等失败：提示并返回设置页；
 *   - 生成成功：展示新码，用户确认妥存后返回设置页。
 *
 * 沿用项目「自右弹出 sheet」模式（header + 左滑返回手势 useSheetDismiss）。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import AppIcon from '@/components/icons/AppIcon.vue'
import RecoveryCodeReveal from '@/components/RecoveryCodeReveal.vue'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { useSheetDismiss } from '@/composables/useSheetDismiss'

const router = useRouter()
const cloudStore = useCloudAccountStore()

/** 生成中（进入即开始） */
const loading = ref(true)
/** 新生成的恢复码（成功后展示，空表示未就绪） */
const newCode = ref('')

/** 请求取消控制器（卸载时中断在途生成请求） */
let abortController = null

/** 返回设置页：有历史则后退（触发向右滑回），否则直接回设置页 */
function handleBack() {
  if (window.history.length > 1) router.back()
  else router.replace({ name: 'Settings' })
}

/** 恢复码已确认妥存：返回设置页 */
function handleConfirm() {
  handleBack()
}

onMounted(async () => {
  abortController = new AbortController()
  try {
    const code = await cloudStore.regenerateRecoveryCode({ signal: abortController.signal })
    if (!code) {
      // 无会话 DataKey（异常态）：无法重新包裹，提示后返回
      ElMessage.error('当前会话不可用，请重新登录后再试')
      handleBack()
      return
    }
    newCode.value = code
  } catch (err) {
    if (err?.name === 'AbortError') return
    ElMessage.error(err?.message || '重新生成失败，请重试')
    handleBack()
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
})

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回
const { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd } = useSheetDismiss({
  onDismiss: handleBack
})
</script>

<template>
  <div
    class="regen-page"
    ref="sheetRoot"
    :style="sheetStyle"
    @touchstart.passive="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- 顶部导航 -->
    <header class="regen-header">
      <button type="button" class="regen-header__back" aria-label="返回" @click="handleBack">
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <h1 class="regen-header__title">重新生成恢复码</h1>
      <span class="regen-header__placeholder" aria-hidden="true"></span>
    </header>

    <main class="regen-page__main">
      <!-- 生成中占位 -->
      <div v-if="loading" class="regen-loading">
        <div class="regen-loading__spinner" aria-hidden="true"></div>
        <p class="regen-loading__text">正在生成新的恢复码…</p>
      </div>

      <!-- 生成成功：复用展示组件（带「旧码已失效」警示） -->
      <RecoveryCodeReveal
        v-else-if="newCode"
        :code="newCode"
        title="已生成新的恢复码"
        subtitle="请立即妥善保存。旧恢复码已失效，今后仅这串新码可用于忘记密码后恢复数据。"
        confirm-text="我已保存，完成"
        :show-legacy-hint="true"
        @confirm="handleConfirm"
      />
    </main>
  </div>
</template>

<style lang="scss" scoped>
.regen-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh; // 固定外壳：header 常驻，主体内部滚动
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
    padding: $spacing-lg $spacing-sm calc(#{$spacing-2xl} + env(safe-area-inset-bottom));
  }
}

// ---- 顶部导航（与分类管理同构）----
.regen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-xs;
  height: calc(#{$layout-header-height} + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) $spacing-sm 0;
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

// ---- 生成中占位 ----
.regen-loading {
  @include flex-col-center;
  gap: $spacing-sm;
  padding: $spacing-3xl 0;

  &__spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba($color-brand, 0.2);
    border-top-color: $color-brand;
    border-radius: $radius-pill;
    animation: regen-spin 0.8s linear infinite;
  }

  &__text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-muted;
  }
}

@keyframes regen-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
