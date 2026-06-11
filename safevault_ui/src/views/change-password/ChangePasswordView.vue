<script setup>
/**
 * ChangePasswordView —— 修改主密码
 *
 * 入口：设置页「安全 → 修改主密码」。需已解锁进入。
 * 依 DRD 4.12「修改主密码需先验证旧凭证」，**身份验证已在设置页前置完成**（验证通过才跳转进来，
 * 避免取消时本页先滑入空白再滑回的白屏）。本页进入即直接呈现表单：
 *   1. 设置新主密码（含强度计）并确认；
 *   2. 「确认修改」提交：更新为新密码，旧密码立即失效。
 *
 * 结构（自上而下）：顶栏 → 视觉锚点 + 说明 → 安全卡片（新密码 + 强度计 + 确认 + 安全建议）
 *   → 底部毛玻璃操作栏。提交编排复用 useChangePassword。
 */
import { ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import AppIcon from '@/components/icons/AppIcon.vue'
import PasswordField from '@/components/PasswordField.vue'
import PasswordStrength from '@/components/PasswordStrength.vue'
import ChangePasswordHeader from './components/ChangePasswordHeader.vue'

import { useChangePassword } from '@/composables/useChangePassword'
import { useSheetDismiss } from '@/composables/useSheetDismiss'

const router = useRouter()
const { submitting, changePassword, generatePassword, cleanup } = useChangePassword()

const newPassword = ref('')
const confirmPassword = ref('')

/** 两次新密码不一致（确认框已输入时才提示） */
const mismatch = computed(
  () => confirmPassword.value.length > 0 && confirmPassword.value !== newPassword.value
)

/** 可提交：两项均非空且一致，且非提交中 */
const canSubmit = computed(
  () =>
    newPassword.value.length > 0 &&
    confirmPassword.value.length > 0 &&
    newPassword.value === confirmPassword.value &&
    !submitting.value
)

/** 返回设置：有历史则后退，否则回设置 Tab */
function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace({ name: 'Settings' })
  }
}

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回设置
const { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd } = useSheetDismiss({
  onDismiss: goBack
})

/**
 * 一键生成强主密码：用已保存的生成规则产出，同时填入「新密码」与「确认密码」，
 * 省去用户手抄随机串（可点眼睛查看 / 另存）。
 */
function onGenerate() {
  if (submitting.value) return
  const pwd = generatePassword()
  if (!pwd) {
    ElMessage.warning('请先在「生成」中至少保留一种字符类型')
    return
  }
  newPassword.value = pwd
  confirmPassword.value = pwd
}

/** 提交修改 */
async function handleSubmit() {
  if (!canSubmit.value) return
  const { ok } = await changePassword(newPassword.value)
  if (ok) {
    // 方案 B：改密成功后全部会话立即失效（store 已清本次登录态），须用新密码重新登录。
    // 故 toast 提示后直接导回登录页（/unlock），用 replace 避免回退到本页或受保护页。
    router.replace({ name: 'Unlock' })
  }
}

// 离开页面时取消未完成的提交请求
onUnmounted(cleanup)
</script>

<template>
  <div
    class="cpw-page"
    ref="sheetRoot"
    :style="sheetStyle"
    @touchstart.passive="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <ChangePasswordHeader />

    <main class="cpw-page__main">
      <!-- 视觉锚点 + 说明 -->
      <section class="cpw-hero">
        <div class="cpw-hero__badge" aria-hidden="true">
          <AppIcon name="shield-lock" :width="18" :height="22" />
        </div>
        <p class="cpw-hero__desc">
          身份已验证，请设置一个新的高强度账户密码以保护您的保险库。
        </p>
      </section>

      <!-- 安全卡片 -->
      <section class="cpw-card">
        <!-- 新主密码 + 强度计 -->
        <div class="cpw-card__group">
          <PasswordField
            v-model="newPassword"
            label="新密码"
            placeholder="请输入或一键生成"
            allow-generate
            :disabled="submitting"
            @generate="onGenerate"
            @submit="handleSubmit"
          />
          <PasswordStrength :password="newPassword" />
        </div>

        <!-- 确认新密码 -->
        <PasswordField
          v-model="confirmPassword"
          label="确认新密码"
          placeholder="再次输入新密码"
          :error="mismatch"
          error-text="两次输入的密码不一致"
          :disabled="submitting"
          @submit="handleSubmit"
        />

        <!-- 安全建议 -->
        <div class="cpw-card__hint">
          <AppIcon name="info" :width="12" :height="14" class="cpw-card__hint-icon" />
          <p class="cpw-card__hint-text">
            建议使用包含大小写字母、数字及特殊字符的组合，长度至少 12 位。
          </p>
        </div>
      </section>
    </main>

    <!-- 底部毛玻璃操作栏 -->
    <footer class="cpw-page__footer">
      <button
        type="button"
        class="cpw-submit"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <AppIcon v-if="!submitting" name="shield-check" :size="18" class="cpw-submit__icon" />
        <span>{{ submitting ? '提交中…' : '确认修改' }}</span>
      </button>
    </footer>
  </div>
</template>

<style lang="scss" scoped>
.cpw-page {
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
    padding: $spacing-xl $spacing-sm $spacing-lg; // 顶 32 / 左右 16 / 底 24
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

// ---- 视觉锚点 + 说明 ----
.cpw-hero {
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

  &__desc {
    max-width: 280px;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }
}

// ---- 安全卡片 ----
.cpw-card {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 字段之间 24px
  width: 100%;
  padding: $spacing-sm; // 16px
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
.cpw-submit {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs; // 图标与文字 8px
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
