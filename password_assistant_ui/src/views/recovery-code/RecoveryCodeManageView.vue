<script setup>
/**
 * RecoveryCodeManageView —— 恢复码管理（重新生成并保存）
 *
 * 入口：设置页「安全 → 恢复码管理」。像素级还原 Figma node 1:2「恢复码保存」。
 * 流程：
 *   1. 进入即拉起系统指纹验证（与登录一致，经全局 useBiometricPrompt——真机系统指纹 /
 *      浏览器降级 mock 弹窗）——重新生成会使旧码失效，属敏感操作；
 *   2. 验证通过 → 揭示页面并生成一组新的恢复码（mock）；验证取消 / 失败 → 放弃并返回设置；
 *   3. 「复制」复制到剪贴板、「保存为图片」导出 PNG；
 *   4. 「我已安全保存」确认并返回设置；「取消」放弃本次重新生成并返回。
 *
 * 交互编排复用 useRecoveryCode（生成 / 复制 / 导出 / 清理），身份验证复用与登录同源的
 * useBiometricPrompt。本页业务为前端 mock，真实接入时只改 store/composable 实现。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import AppIcon from '@/components/icons/AppIcon.vue'
import RecoveryCodeCard from './components/RecoveryCodeCard.vue'

import { useRecoveryCode } from '@/composables/useRecoveryCode'
import { useBiometricPrompt } from '@/composables/useBiometricPrompt'

const router = useRouter()
const { code, generating, saving, generate, copyCode, saveAsImage, cleanup } = useRecoveryCode()
const { requestBiometric } = useBiometricPrompt()

/** 是否已通过身份验证并揭示恢复码 */
const revealed = ref(false)

/**
 * 进入即身份验证：与登录一致，经全局指纹流程拉起系统指纹
 * （真机系统指纹框 / 浏览器降级 mock 弹窗）。
 * 通过 → 揭示页面并生成新恢复码；取消 / 失败 → 放弃并返回设置。
 */
async function verifyIdentity() {
  const ok = await requestBiometric('verify')
  if (!ok) {
    goBack()
    return
  }
  revealed.value = true
  await generate()
}

/** 返回设置：有历史则后退，否则回设置 Tab */
function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace({ name: 'Settings' })
  }
}

/** 已安全保存：确认更新并返回 */
function onConfirmSaved() {
  if (generating.value) return
  ElMessage.success('恢复码已更新，旧恢复码已失效')
  goBack()
}

// 进入即拉起指纹验证
onMounted(verifyIdentity)
// 离开页面时取消进行中的生成请求
onUnmounted(cleanup)
</script>

<template>
  <div class="rcm-page">
    <!-- 顶栏占位（避让状态栏，对齐 Figma 1:3 非导航顶栏） -->
    <header class="rcm-page__bar"></header>

    <main v-if="revealed" class="rcm-page__main">
      <!-- 视觉锚点 + 标题 -->
      <section class="rcm-hero">
        <div class="rcm-hero__badge" aria-hidden="true">
          <AppIcon name="account-key" :width="30.667" :height="16" />
        </div>
        <h1 class="rcm-hero__title">您的账户恢复码</h1>
        <p class="rcm-hero__subtitle">这是在忘记主密码时，恢复您加密资料的唯一凭据。</p>
      </section>

      <!-- 警示卡 -->
      <div class="rcm-warning">
        <AppIcon name="warning" :size="20" class="rcm-warning__icon" />
        <p class="rcm-warning__text">
          忘记主密码时，凭它找回密码。请妥善保存，一旦丢失，只能通过人工帮您重置账户。
        </p>
      </div>

      <!-- 恢复码 + 快捷操作 -->
      <section class="rcm-code">
        <RecoveryCodeCard :code="code" :loading="generating" />
        <div class="rcm-actions">
          <button
            type="button"
            class="rcm-action"
            :disabled="generating"
            @click="copyCode"
          >
            <AppIcon name="copy" :width="17" :height="20" />
            <span>复制</span>
          </button>
          <button
            type="button"
            class="rcm-action"
            :disabled="generating || saving"
            @click="saveAsImage"
          >
            <AppIcon name="image" :size="18" />
            <span>{{ saving ? '保存中…' : '保存为图片' }}</span>
          </button>
        </div>
      </section>

      <!-- 主行动区 -->
      <section class="rcm-cta">
        <button
          type="button"
          class="rcm-cta__primary"
          :disabled="generating"
          @click="onConfirmSaved"
        >
          我已安全保存
        </button>
        <button type="button" class="rcm-cta__ghost" @click="goBack">取消</button>
      </section>

      <!-- 安全说明页脚 -->
      <footer class="rcm-footer">
        <div class="rcm-footer__badge">
          <AppIcon name="lock" :width="9.333" :height="11.667" />
          <span>END-TO-END ENCRYPTED</span>
        </div>
        <p class="rcm-footer__note">
          SafeVault 使用 AES-256 和 Argon2id 算法保护您的数据。账户恢复码仅在您的本地设备生成，我们绝不会接触您的任何私钥。
        </p>
      </footer>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.rcm-page {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background-color: $color-bg-page;

  // 顶栏占位
  &__bar {
    flex-shrink: 0;
    height: calc(#{$layout-header-height} + env(safe-area-inset-top));
    padding-top: env(safe-area-inset-top);
    background-color: $color-bg-header;
  }

  // 主体：可滚动，内容顶对齐
  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-lg $spacing-sm
      calc(#{$spacing-lg} + env(safe-area-inset-bottom));
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
}

// ---- 视觉锚点 + 标题 ----
.rcm-hero {
  @include flex-col-center;
  padding-bottom: $spacing-xl; // 32px

  &__badge {
    @include flex-center;
    @include circle(64px);
    margin-bottom: $spacing-sm; // 16px
    background-color: $color-brand;
    color: $color-on-brand; // 图标 currentColor 跟随
    box-shadow: $shadow-fab-neutral;
  }

  &__title {
    font-size: $font-size-heading; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-heading;
    color: $color-text-strong;
    text-align: center;
  }

  &__subtitle {
    margin-top: $spacing-xs; // 8px
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }
}

// ---- 警示卡 ----
.rcm-warning {
  display: flex;
  align-items: flex-start;
  gap: $spacing-2xs; // 12px
  margin-bottom: $spacing-xl; // 32px
  padding: $spacing-sm; // 16px（设计 17px，取栅格值）
  background-color: $color-warning-soft;
  border: 1px solid rgba($color-warning, 0.35);
  border-radius: $radius-md;

  &__icon {
    flex-shrink: 0;
    margin-top: 1px;
    color: $color-warning;
  }

  &__text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-warning;
  }
}

// ---- 恢复码 + 快捷操作 ----
.rcm-code {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 24px
  margin-bottom: $spacing-2xl; // 40px
}

.rcm-actions {
  display: flex;
  gap: $spacing-sm; // 16px
}

.rcm-action {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs; // 8px
  flex: 1;
  min-width: 0;
  height: 56px;
  border: 2px solid $color-border;
  border-radius: $radius-md;
  color: $color-text-regular;
  transition:
    background-color $transition-base,
    transform $transition-fast;

  span {
    font-size: $font-size-body; // 16px（设计 17px）
    line-height: $line-height-body;
  }

  &:hover:not(:disabled) {
    background-color: rgba($line-base, 0.18);
  }

  &:active:not(:disabled) {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

// ---- 主行动区 ----
.rcm-cta {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm; // 16px
}

.rcm-cta__primary {
  @include button-reset;
  @include flex-center;
  width: 100%;
  height: 56px;
  background-color: $color-link; // #004ac6
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  font-size: $font-size-body; // 16px（设计 17px）
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

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.rcm-cta__ghost {
  @include button-reset;
  @include flex-center;
  width: 100%;
  height: 56px;
  font-size: $font-size-body; // 16px
  line-height: $line-height-body;
  color: $color-text-muted;
  transition: color $transition-base;

  &:hover {
    color: $color-text-regular;
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
    border-radius: $radius-sm;
  }
}

// ---- 安全说明页脚 ----
.rcm-footer {
  @include flex-col-center;
  gap: $spacing-xs; // 8px
  margin-top: auto; // 内容不足时贴底
  padding-top: $spacing-lg; // 24px

  &__badge {
    @include flex-center;
    gap: $spacing-xxs; // 4px
    color: $color-text-muted;

    span {
      font-family: $font-family-mono;
      font-size: $font-size-caption; // 12px
      font-weight: $font-weight-bold;
      line-height: $line-height-caption;
      letter-spacing: $letter-spacing-caption;
      text-transform: uppercase;
    }
  }

  &__note {
    max-width: 300px;
    font-size: $font-size-micro; // 10px
    line-height: $line-height-micro;
    color: $color-text-muted;
    text-align: center;
    opacity: 0.6;
  }
}
</style>
