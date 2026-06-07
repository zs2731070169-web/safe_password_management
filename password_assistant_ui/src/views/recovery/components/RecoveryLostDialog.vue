<script setup>
/**
 * RecoveryLostDialog —— 「恢复码也丢失了」危险警示弹窗
 *
 * 居中模态卡片 + 置灰遮罩。用于告知用户：基于零知识加密，
 * 主密码与恢复码均丢失时数据不可恢复。
 * 支持点击遮罩 / ESC 关闭，打开时锁定背景滚动。
 * 通过 <Teleport> 挂到 body，规避父级 overflow / max-width 裁剪。
 */
import { watch, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  /** 显隐（v-model） */
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

function close() {
  emit('update:modelValue', false)
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

// 打开时监听 ESC 并锁定背景滚动，关闭时复原
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
    }
  }
)

// 兜底清理：组件卸载时解除监听与滚动锁定
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="rc-dialog">
      <div v-if="modelValue" class="rc-dialog" @click.self="close">
        <div
          class="rc-dialog__panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="rc-dialog-title"
          aria-describedby="rc-dialog-desc"
        >
          <!-- 危险警示徽章 -->
          <div class="rc-dialog__badge">
            <AppIcon name="warning" :size="28" />
          </div>

          <h2 id="rc-dialog-title" class="rc-dialog__title">恢复码也无法找回？</h2>
          <p id="rc-dialog-desc" class="rc-dialog__desc">
            出于零知识加密的安全设计，若主密码与恢复码均已丢失，SafeVault
            无法为您找回保险库中的数据。您可以重新创建一个新的保险库重新开始。
          </p>

          <button type="button" class="rc-dialog__confirm" @click="close">
            我已了解
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
// ---- 遮罩 ----
.rc-dialog {
  position: fixed;
  inset: 0;
  z-index: $z-overlay;
  @include flex-center;
  padding: $spacing-lg;
  background-color: $color-overlay;
}

// ---- 弹窗卡片 ----
.rc-dialog__panel {
  @include flex-col-center;
  width: 100%;
  max-width: 320px;
  padding: $spacing-lg;
  background-color: $color-bg-card;
  border-radius: $radius-lg;
  box-shadow: $shadow-biometric;
  text-align: center;
}

// 危险警示徽章（危险软底 + 危险图标）
.rc-dialog__badge {
  @include flex-center;
  @include circle(56px);
  margin-bottom: $spacing-sm;
  background-color: $color-danger-soft;
  color: $color-danger;
}

.rc-dialog__title {
  font-size: $font-size-list-title; // 17px
  font-weight: $font-weight-medium;
  line-height: $line-height-list-title;
  color: $color-text-strong;
}

.rc-dialog__desc {
  margin-top: $spacing-2xs; // 12px
  font-size: $font-size-sm; // 14px
  line-height: $line-height-sm;
  color: $color-text-regular;
}

// 确认按钮（品牌实心，与页面主按钮一致风格）
.rc-dialog__confirm {
  @include button-reset;
  @include flex-center;
  width: 100%;
  height: 48px;
  margin-top: $spacing-lg; // 24px
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  font-size: $font-size-body; // 16px
  font-weight: $font-weight-medium;
  line-height: $line-height-body;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast;

  &:hover {
    filter: brightness(0.94);
  }

  &:active {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }
}

// ---- 进出场动画：遮罩淡入 + 卡片轻微缩放 ----
.rc-dialog-enter-active,
.rc-dialog-leave-active {
  transition: opacity $transition-base;
}

.rc-dialog-enter-active .rc-dialog__panel,
.rc-dialog-leave-active .rc-dialog__panel {
  transition: transform $transition-base;
}

.rc-dialog-enter-from,
.rc-dialog-leave-to {
  opacity: 0;
}

.rc-dialog-enter-from .rc-dialog__panel,
.rc-dialog-leave-to .rc-dialog__panel {
  transform: scale(0.96);
}
</style>
