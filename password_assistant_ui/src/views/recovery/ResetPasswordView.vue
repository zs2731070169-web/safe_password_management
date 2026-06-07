<script setup>
/**
 * ResetPasswordView —— 找回访问权限·步骤 2/2：重设主密码
 *
 * 像素级还原 Figma「找回访问权限-重设主密码」(node 1:263)。
 * 结构（自上而下）：
 *   1. 顶部导航：返回 + 标题「重设主密码」+ 右侧盾牌
 *   2. 状态区：绿色成功徽章 +「步骤 2/2」进度条 + 说明
 *   3. 安全卡片：新主密码（含强度计）+ 确认密码 + 安全建议
 *   4. 底部毛玻璃操作栏：「完成并进入」（两次密码一致方可提交）
 *
 * 交互编排复用 useResetPassword：模拟重置延迟，成功后标记已解锁并进入密码库。
 */
import { ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/icons/AppIcon.vue'
import ResetPasswordHeader from './components/ResetPasswordHeader.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordStrength from '@/components/PasswordStrength.vue'

import { useResetPassword } from '@/composables/useResetPassword'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const { resetting, resetMasterPassword, cleanup } = useResetPassword()

const newPassword = ref('')
const confirmPassword = ref('')

/** 两次输入不一致（确认框已输入时才提示） */
const mismatch = computed(
  () => confirmPassword.value.length > 0 && confirmPassword.value !== newPassword.value
)

/** 可提交：两次均非空且一致，且非提交中 */
const canSubmit = computed(
  () =>
    newPassword.value.length > 0 &&
    confirmPassword.value.length > 0 &&
    newPassword.value === confirmPassword.value &&
    !resetting.value
)

/** 提交重置 */
async function handleSubmit() {
  if (!canSubmit.value) return
  const ok = await resetMasterPassword(newPassword.value)
  if (ok) {
    // 身份已通过恢复码确认，重置成功即视为已解锁，直接进入密码库
    authStore.markUnlocked()
    router.replace({ name: 'Vault' })
  }
}

// 离开页面时取消未完成的重置请求
onUnmounted(cleanup)
</script>

<template>
  <div class="reset-page">
    <ResetPasswordHeader />

    <main class="reset-page__main">
      <!-- 状态区 -->
      <div class="reset-status">
        <div class="reset-status__badge">
          <AppIcon name="shield-check" :width="20" :height="25" />
        </div>
        <div class="reset-status__progress">
          <span class="reset-status__step">步骤 2/2</span>
          <span class="reset-status__bars">
            <span class="reset-status__bar"></span>
            <span class="reset-status__bar"></span>
          </span>
        </div>
        <p class="reset-status__desc">请设置一个新的高强度主密码以保护您的保险库</p>
      </div>

      <!-- 安全卡片 -->
      <section class="reset-card">
        <!-- 新主密码 + 强度计 -->
        <div class="reset-card__group">
          <PasswordField
            v-model="newPassword"
            label="新主密码"
            placeholder="请输入高强度密码"
            :disabled="resetting"
            @submit="handleSubmit"
          />
          <PasswordStrength :password="newPassword" />
        </div>

        <!-- 确认密码 -->
        <PasswordField
          v-model="confirmPassword"
          label="确认密码"
          placeholder="再次输入新密码"
          :error="mismatch"
          error-text="两次输入的密码不一致"
          :disabled="resetting"
          @submit="handleSubmit"
        />

        <!-- 安全建议 -->
        <div class="reset-card__hint">
          <AppIcon name="info" :width="12" :height="14" class="reset-card__hint-icon" />
          <p class="reset-card__hint-text">
            建议使用包含大小写字母、数字及特殊字符的组合，长度至少 12 位。
          </p>
        </div>
      </section>
    </main>

    <!-- 底部毛玻璃操作栏 -->
    <footer class="reset-page__footer">
      <button
        type="button"
        class="reset-submit"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <span>{{ resetting ? '重置中…' : '完成并进入' }}</span>
        <AppIcon v-if="!resetting" name="login" :size="18" class="reset-submit__icon" />
      </button>
    </footer>
  </div>
</template>

<style lang="scss" scoped>
.reset-page {
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
    padding: $spacing-xl $spacing-sm $spacing-lg; // 顶 32px / 左右 16px
  }

  // ---- 底部毛玻璃操作栏 ----
  &__footer {
    flex-shrink: 0;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-sm;
    padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom));
    background-color: rgba($color-tile-blue, 0.8); // 浅蓝毛玻璃底
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
}

// ---- 状态区 ----
.reset-status {
  @include flex-col-center;
  padding-bottom: $spacing-xl; // 32px

  // 绿色成功徽章
  &__badge {
    @include flex-center;
    @include circle(64px);
    margin-bottom: $spacing-sm; // 16px
    background-color: $color-health-bg;
    color: $color-health-text; // 盾牌图标跟随
  }

  // 步骤指示 + 进度条
  &__progress {
    display: flex;
    align-items: center;
    gap: $spacing-xs; // 8px
    margin-bottom: $spacing-xs; // 8px
  }

  &__step {
    font-family: $font-family-mono;
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-bold;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-brand;
  }

  &__bars {
    display: flex;
    gap: $spacing-xxs; // 4px
  }

  &__bar {
    width: 32px;
    height: 4px;
    background-color: $color-brand; // 两段全亮 = 已到末步
    border-radius: $radius-pill;
  }

  &__desc {
    margin-top: $spacing-xxs; // 4px
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }
}

// ---- 安全卡片 ----
.reset-card {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 字段之间 24px
  width: 100%;
  padding: $spacing-sm; // 16px（设计 17px，取栅格值）
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  // 新密码字段 + 强度计为一组（间距 8px）
  &__group {
    display: flex;
    flex-direction: column;
    gap: $spacing-xs; // 8px
  }

  // 安全建议提示框
  &__hint {
    display: flex;
    align-items: flex-start;
    gap: $spacing-xs; // 8px
    padding: $spacing-2xs; // 12px
    background-color: $color-bg-input;
    border-radius: $radius-sm;
  }

  &__hint-icon {
    flex-shrink: 0;
    margin-top: 2px; // 与首行文字对齐
    color: $color-brand;
  }

  &__hint-text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
  }
}

// ---- 底部主按钮 ----
.reset-submit {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs; // 文字与图标 8px
  width: 100%;
  height: 56px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-biometric;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  span {
    font-size: $font-size-logo; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-logo;
  }

  &__icon {
    color: $color-white;
  }

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
    opacity: 0.5;
  }
}
</style>
