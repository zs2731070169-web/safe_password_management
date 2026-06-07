<script setup>
/**
 * RecoveryCodeView —— 找回访问权限·步骤 1/2：验证恢复码
 *
 * 像素级还原 Figma「验证恢复码」(node 2:2)。
 * 结构（自上而下）：
 *   1. 顶部导航：返回 + 居中标题「找回访问权限」
 *   2. 主体（可滚动）：
 *      - 视觉锚点：蓝色圆形 + 恢复码栅格图标
 *      - 步骤指示「步骤 1 / 2」+ 标题「请输入您保存的恢复码 (25 位)」
 *      - 恢复码输入框 + 错误提示
 *      - 来源说明提示框
 *      - 「恢复码也丢失了？」帮助链接
 *   3. 底部固定主按钮：验证并重置密码（未填满 25 位时禁用）
 *
 * 交互编排复用 useRecovery：模拟验证延迟，正确恢复码
 * 「12345-12345-12345-12345-12345」视为通过，组件卸载时取消进行中的请求。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/icons/AppIcon.vue'
import RecoveryHeader from './components/RecoveryHeader.vue'
import RecoveryCodeInput from './components/RecoveryCodeInput.vue'
import RecoveryLostDialog from './components/RecoveryLostDialog.vue'

import { useRecovery } from '@/composables/useRecovery'

const router = useRouter()

const { verifying, errorMsg, verifyRecoveryCode, cleanup } = useRecovery()

/** 已格式化的恢复码（含连字符） */
const code = ref('')

/** 「恢复码也丢失了」弹窗显隐 */
const lostDialogVisible = ref(false)

/** 去掉连字符后的有效位数 */
const cleanLength = computed(() => code.value.replace(/-/g, '').length)
/** 是否已填满 25 位 */
const isComplete = computed(() => cleanLength.value === 25)
/** 主按钮可用：填满且非验证中 */
const canSubmit = computed(() => isComplete.value && !verifying.value)

// 重新输入即清除上一次的错误提示
watch(code, () => {
  if (errorMsg.value) errorMsg.value = ''
})

/** 提交验证 */
async function handleVerify() {
  if (!canSubmit.value) return
  const ok = await verifyRecoveryCode(code.value)
  if (ok) {
    // 步骤 2/2 —— 进入重设主密码页面
    router.push({ name: 'ResetPassword' })
  }
}

/** 恢复码也丢失：弹出危险警示弹窗 */
function handleLostCode() {
  lostDialogVisible.value = true
}

// 离开页面时取消未完成的验证请求
onUnmounted(cleanup)
</script>

<template>
  <div class="recovery-page">
    <RecoveryHeader title="找回访问权限" />

    <main class="recovery-page__main">
      <!-- 视觉锚点：蓝色圆形 + 恢复码栅格图标 -->
      <div class="recovery-anchor">
        <div class="recovery-anchor__badge">
          <AppIcon name="recovery-key" :size="27" />
        </div>
      </div>

      <!-- 步骤指示 + 标题 -->
      <div class="recovery-intro">
        <p class="recovery-intro__step">步骤 1 / 2</p>
        <h2 class="recovery-intro__heading">请输入您保存的恢复码 (25 位)</h2>
      </div>

      <!-- 恢复码输入区 -->
      <section class="recovery-form">
        <RecoveryCodeInput
          v-model="code"
          :error="Boolean(errorMsg)"
          :disabled="verifying"
          @submit="handleVerify"
        />
        <p v-if="errorMsg" class="recovery-form__error">{{ errorMsg }}</p>

        <!-- 来源说明提示框（黄色警示，强调重要性） -->
        <div class="recovery-hint">
          <AppIcon name="warning" :size="18" class="recovery-hint__icon" />
          <p class="recovery-hint__text">
            恢复码是您在创建保险库时生成的唯一凭据。请确保从您的安全备份文件中复制。
          </p>
        </div>
      </section>

      <!-- 帮助链接 -->
      <div class="recovery-help">
        <button type="button" class="recovery-help__link" @click="handleLostCode">
          恢复码也丢失了？
        </button>
      </div>
    </main>

    <!-- 底部固定主按钮 -->
    <footer class="recovery-footer">
      <button
        type="button"
        class="recovery-submit"
        :disabled="!canSubmit"
        @click="handleVerify"
      >
        {{ verifying ? '验证中…' : '验证并重置密码' }}
      </button>
    </footer>

    <!-- 「恢复码也丢失了」危险警示弹窗 -->
    <RecoveryLostDialog v-model="lostDialogVisible" />
  </div>
</template>

<style lang="scss" scoped>
.recovery-page {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background-color: $color-bg-page;

  // ---- 主体：可滚动，内容顶对齐 ----
  &__main {
    flex: 1;
    overflow-y: auto;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-sm $spacing-sm 0; // 左右 16px
  }
}

// ---- 视觉锚点 ----
.recovery-anchor {
  @include flex-center;
  padding: $spacing-2xs 0 $spacing-lg; // 上 12px / 下 24px

  // 蓝色圆形徽章（亮品牌蓝底，浅色栅格图标）
  &__badge {
    @include flex-center;
    @include circle(80px);
    background-color: $color-brand-bright;
    color: $color-on-brand; // 图标 currentColor 跟随
  }
}

// ---- 步骤指示 + 标题 ----
.recovery-intro {
  @include flex-col-center;
  gap: $spacing-2xs; // 12px
  padding-bottom: $spacing-xl; // 32px

  &__step {
    font-family: $font-family-mono;
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-bold;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-brand;
    text-align: center;
  }

  &__heading {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-text-strong;
    text-align: center;
  }
}

// ---- 输入区 ----
.recovery-form {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm; // 16px

  &__error {
    margin-top: -$spacing-xs; // 贴近输入框
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-danger;
  }
}

// 来源说明提示框（黄色警示，强调「很重要」）
.recovery-hint {
  display: flex;
  align-items: flex-start;
  gap: $spacing-2xs; // 12px
  padding: $spacing-sm; // 16px（设计 17px，取栅格值）
  background-color: $color-warning-soft; // 琥珀黄底
  border-radius: $radius-md;

  &__icon {
    flex-shrink: 0;
    margin-top: 2px; // 与首行文字基线对齐
    color: $color-warning;
  }

  &__text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-warning; // 深棕文字，黄底上对比清晰
  }
}

// ---- 帮助链接 ----
.recovery-help {
  @include flex-center;
  padding-top: $spacing-lg; // 24px

  &__link {
    @include button-reset;
    padding: $spacing-xs;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-brand;
    transition: opacity $transition-base;

    &:hover {
      opacity: 0.75;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
      border-radius: $radius-sm;
    }
  }
}

// ---- 底部固定主按钮 ----
.recovery-footer {
  flex-shrink: 0;
  width: 100%;
  max-width: $layout-content-max-width;
  margin: 0 auto;
  padding: $spacing-sm;
  padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom));
  background-color: $color-bg-page;
}

.recovery-submit {
  @include button-reset;
  @include flex-center;
  width: 100%;
  height: 56px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  font-size: $font-size-body; // 16px
  font-weight: $font-weight-medium;
  line-height: $line-height-body;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  &:hover:not(:disabled) {
    filter: brightness(0.94);
  }

  &:active:not(:disabled) {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  // 未填满 / 验证中：半透明禁用态（对齐设计 opacity 0.5）
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}
</style>
