<script setup>
/**
 * IdentityVerifyModal —— 通用身份验证界面（敏感操作前置）
 *
 * 用户须通过 **指纹** 或 **主密码** 完成验证后才放行；验证状态、错误与影响提示
 * 均在同一界面内给出。文案 / 影响提示 / 确认按钮通过 props 定制，供删除条目、
 * 重新生成恢复码等多处复用。
 *
 * 交互编排复用 useIdentityVerify（指纹 mock / 主密码校验、loading、取消）。
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useIdentityVerify } from '@/composables/useIdentityVerify'

const props = defineProps({
  /** 显隐（v-model） */
  modelValue: {
    type: Boolean,
    default: false
  },
  /** 标题文案 */
  title: {
    type: String,
    default: '验证身份'
  },
  /** 影响提示（黄色警示条文案，留空则不显示提示条） */
  hint: {
    type: String,
    default: ''
  },
  /** 提示条图标名 */
  hintIcon: {
    type: String,
    default: 'info'
  },
  /** 主密码模式下确认按钮文案 */
  confirmText: {
    type: String,
    default: '确认'
  },
  /** 确认按钮色调：'brand'（品牌蓝）| 'danger'（危险红） */
  tone: {
    type: String,
    default: 'brand',
    validator: (val) => ['brand', 'danger'].includes(val)
  }
})

const emit = defineEmits(['update:modelValue', 'verified'])

const { verifying, errorMsg, verifyByBiometric, verifyByPassword, cleanup } = useIdentityVerify()

/** 当前验证方式：'biometric'（默认）| 'password' —— 同一时刻只显示一种 */
const mode = ref('biometric')
/** 主密码输入 */
const password = ref('')
/** 明文显示主密码 */
const showPassword = ref(false)

/** 切换验证方式（清空上一种方式的输入与错误） */
function switchMode(target) {
  mode.value = target
  password.value = ''
  showPassword.value = false
  errorMsg.value = ''
}

/** 指纹验证 */
async function onBiometric() {
  if (verifying.value) return
  const ok = await verifyByBiometric()
  if (ok) emit('verified')
}

/** 主密码验证 */
async function onPasswordConfirm() {
  if (verifying.value) return
  const ok = await verifyByPassword(password.value)
  if (ok) emit('verified')
}

/** 取消关闭 */
function onCancel() {
  emit('update:modelValue', false)
}

function onKeydown(event) {
  if (event.key === 'Escape') onCancel()
}

// 打开/关闭：监听 ESC、锁定滚动、复位状态。
// immediate 确保「挂载即打开」（如恢复码管理页进入即验证）也能正确加锁与绑定。
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
      mode.value = 'biometric'
      password.value = ''
      showPassword.value = false
      cleanup()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
  cleanup()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="iv-modal" appear>
      <div v-if="modelValue" class="iv-modal" @click.self="onCancel">
        <div
          class="iv-modal__panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="iv-modal-title"
        >
          <h3 id="iv-modal-title" class="iv-modal__title">{{ title }}</h3>
          <p v-if="hint" class="iv-modal__hint">
            <AppIcon :name="hintIcon" :width="14" :height="14" class="iv-modal__hint-icon" />
            <span>{{ hint }}</span>
          </p>

          <!-- 指纹验证模式（默认） -->
          <template v-if="mode === 'biometric'">
            <button
              type="button"
              class="iv-bio"
              :class="{ 'is-active': verifying }"
              :disabled="verifying"
              @click="onBiometric"
            >
              <span class="iv-bio__ring">
                <AppIcon name="fingerprint" :width="34" :height="38" />
              </span>
              <span class="iv-bio__label">
                {{ verifying ? '正在验证指纹…' : '轻触使用指纹验证' }}
              </span>
            </button>

            <p v-if="errorMsg" class="iv-modal__error iv-modal__error--center">{{ errorMsg }}</p>

            <div class="iv-hr"></div>

            <button
              type="button"
              class="iv-switch"
              :disabled="verifying"
              @click="switchMode('password')"
            >
              使用主密码验证
            </button>

            <div class="iv-modal__actions">
              <button type="button" class="iv-btn iv-btn--ghost" :disabled="verifying" @click="onCancel">
                取消
              </button>
            </div>
          </template>

          <!-- 主密码验证模式 -->
          <template v-else>
            <div class="iv-input" :class="{ 'iv-input--error': errorMsg }">
              <input
                class="iv-input__field"
                :type="showPassword ? 'text' : 'password'"
                v-model="password"
                placeholder="请输入主密码"
                autocomplete="current-password"
                :disabled="verifying"
                @keydown.enter="onPasswordConfirm"
              />
              <button
                type="button"
                class="iv-input__toggle"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <AppIcon :name="showPassword ? 'eye' : 'eye-off'" :size="18" />
              </button>
            </div>

            <p v-if="errorMsg" class="iv-modal__error">{{ errorMsg }}</p>

            <button
              type="button"
              class="iv-switch"
              :disabled="verifying"
              @click="switchMode('biometric')"
            >
              改用指纹验证
            </button>

            <div class="iv-modal__actions">
              <button type="button" class="iv-btn iv-btn--ghost" :disabled="verifying" @click="onCancel">
                取消
              </button>
              <button
                type="button"
                class="iv-btn"
                :class="tone === 'danger' ? 'iv-btn--danger' : 'iv-btn--primary'"
                :disabled="verifying || !password"
                @click="onPasswordConfirm"
              >
                {{ verifying ? '验证中…' : confirmText }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.iv-modal {
  position: fixed;
  inset: 0;
  z-index: $z-overlay;
  @include flex-center;
  padding: $spacing-lg;
  background-color: $color-overlay;

  &__panel {
    @include flex-col-center;
    width: 100%;
    max-width: 332px;
    padding: $spacing-lg;
    background-color: $color-bg-card;
    border-radius: $radius-lg;
    box-shadow: $shadow-fab-neutral;
    text-align: center;
  }

  &__title {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  // 影响提示（黄色警示，同界面）
  &__hint {
    display: flex;
    align-items: flex-start;
    gap: $spacing-xs;
    width: 100%;
    margin-top: $spacing-2xs;
    padding: $spacing-2xs;
    background-color: $color-warning-soft;
    border-radius: $radius-sm;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-warning;
    text-align: left;
  }

  &__hint-icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: $color-warning;
  }

  &__error {
    width: 100%;
    margin-top: $spacing-xs;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-danger;
    text-align: left;

    &--center {
      text-align: center;
    }
  }

  &__actions {
    display: flex;
    gap: $spacing-2xs; // 12px
    width: 100%;
    margin-top: $spacing-lg;
  }
}

// 指纹验证区
.iv-bio {
  @include button-reset;
  @include flex-col-center;
  gap: $spacing-xs;
  width: 100%;
  margin-top: $spacing-lg;

  &__ring {
    @include flex-center;
    @include circle(72px);
    background-color: $color-brand-soft;
    color: $color-brand;
    transition:
      background-color $transition-base,
      transform $transition-fast;
  }

  &__label {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-brand;
  }

  &:hover:not(:disabled) .iv-bio__ring {
    background-color: $color-brand-pale;
  }

  &:active:not(:disabled) .iv-bio__ring {
    transform: scale(0.96);
  }

  &:focus-visible {
    outline: none;

    .iv-bio__ring {
      outline: 3px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }

  &:disabled {
    cursor: progress;
  }

  // 验证中：脉冲
  &.is-active .iv-bio__ring {
    animation: iv-pulse 1.2s ease-in-out infinite;
  }
}

@keyframes iv-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.92);
    opacity: 0.6;
  }
}

// 指纹与「使用主密码验证」之间的分隔线
.iv-hr {
  width: 100%;
  height: 1px;
  margin-top: $spacing-lg;
  background-color: rgba($line-base, 0.6);
}

// 切换验证方式（文字按钮）
.iv-switch {
  @include button-reset;
  margin-top: $spacing-sm;
  padding: $spacing-xs;
  border-radius: $radius-sm;
  font-size: $font-size-sm; // 14px
  line-height: $line-height-sm;
  color: $color-brand;
  transition: opacity $transition-base;

  &:hover:not(:disabled) {
    text-decoration: underline;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }
}

// 主密码输入
.iv-input {
  display: flex;
  align-items: center;
  width: 100%;
  margin-top: $spacing-lg;
  padding: 0 $spacing-xs 0 $spacing-sm;
  height: 48px;
  background-color: $color-bg-input;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  transition:
    border-color $transition-base,
    box-shadow $transition-base;

  &:focus-within {
    border-color: $color-brand;
    box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
  }

  &--error {
    border-color: $color-danger;

    &:focus-within {
      box-shadow: 0 0 0 3px rgba($color-danger, 0.12);
    }
  }

  &__field {
    @include button-reset;
    flex: 1;
    min-width: 0;
    height: 100%;
    font-size: $font-size-body; // 16px
    color: $color-text-strong;
    cursor: text;

    &::placeholder {
      color: $color-text-muted;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  &__toggle {
    @include button-reset;
    @include flex-center;
    flex-shrink: 0;
    padding: $spacing-xs;
    border-radius: $radius-sm;
    color: $color-text-muted;
    transition: color $transition-base;

    &:hover {
      color: $color-text-regular;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }
}

// 操作按钮
.iv-btn {
  @include button-reset;
  @include flex-center;
  flex: 1;
  height: 44px;
  border-radius: $radius-sm;
  font-size: $font-size-body; // 16px
  line-height: $line-height-body;
  transition:
    background-color $transition-base,
    filter $transition-base,
    opacity $transition-base;

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &--ghost {
    background-color: $color-brand-pale;
    color: $color-brand;

    &:hover:not(:disabled) {
      background-color: rgba($color-brand, 0.16);
    }
  }

  &--primary {
    background-color: $color-brand;
    color: $color-white;

    &:hover:not(:disabled) {
      filter: brightness(0.94);
    }
  }

  &--danger {
    background-color: $color-danger;
    color: $color-white;

    &:hover:not(:disabled) {
      filter: brightness(0.94);
    }
  }
}

// ---- 进出场动画 ----
.iv-modal-enter-active,
.iv-modal-leave-active {
  transition: opacity $transition-base;
}

.iv-modal-enter-active .iv-modal__panel,
.iv-modal-leave-active .iv-modal__panel {
  transition: transform $transition-base;
}

.iv-modal-enter-from,
.iv-modal-leave-to {
  opacity: 0;
}

.iv-modal-enter-from .iv-modal__panel,
.iv-modal-leave-to .iv-modal__panel {
  transform: scale(0.95);
}
</style>
