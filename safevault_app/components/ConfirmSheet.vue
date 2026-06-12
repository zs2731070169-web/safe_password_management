<script setup>
/**
 * ConfirmSheet —— 移动端底部确认面板（Action Sheet）
 *
 * 替代桌面式居中弹窗，用于危险/重要操作的二次确认（如彻底删除、清空回收站）。
 * 遮罩置灰背景 + 面板自底部滑入；标题 + 说明，下方堆叠「确认（可危险色）」与「取消」整宽按钮。
 * 点击遮罩 / 取消 / 按 ESC 关闭，打开时锁定页面滚动。与设置页选项抽屉、解锁验证弹窗的视觉语言保持一致。
 *
 * 用法：v-model 控制显隐，@confirm 接收确认事件（确认后自动关闭）。
 */
import { watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  /** 显隐（v-model） */
  modelValue: {
    type: Boolean,
    default: false
  },
  /** 标题 */
  title: {
    type: String,
    default: ''
  },
  /** 说明文案（可选） */
  message: {
    type: String,
    default: ''
  },
  /** 确认按钮文案 */
  confirmText: {
    type: String,
    default: '确定'
  },
  /** 取消按钮文案 */
  cancelText: {
    type: String,
    default: '取消'
  },
  /** 确认按钮色调：'danger'（危险红）| 'brand'（品牌蓝） */
  tone: {
    type: String,
    default: 'danger',
    validator: (v) => ['danger', 'brand'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

/** 关闭（取消 / 点击遮罩 / ESC） */
function close() {
  emit('update:modelValue', false)
}

/** 确认：上抛事件并关闭 */
function onConfirm() {
  emit('confirm')
  close()
}

// ESC 关闭 / 锁定页面滚动：均为 H5（浏览器）专属行为。
// App 端无 document、无 ESC 键、滚动由原生页面承载，故整体用条件编译隔离，
// 仅 H5 编译进 document 副作用；App 端为空，弹窗显隐纯由 v-if + 过渡承载。
// #ifdef H5
/** ESC 关闭（仅 H5） */
function onKeydown(e) {
  if (e.key === 'Escape') close()
}

// 打开/关闭：监听 ESC 并锁定 / 恢复页面滚动
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

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
// #endif
</script>

<!-- 不用 Vue 内置 <Transition>：uni-app app-vue 端 <Transition> 的 leave 阶段不可靠（离场元素
     常不被移除、transitionend 不触发），导致遮罩卡住、点取消关不掉。改为元素常驻 + --open 类切换：
     关闭态用 visibility/opacity/pointer-events 收起（不拦截点击），开启态恢复可见可点，
     滑入淡出动画由 CSS transition 承载（与 SettingItem 的 option-sheet 同思路，App/H5 双端可靠）。 -->
<template>
  <view
    class="confirm-sheet"
    :class="{ 'confirm-sheet--open': modelValue }"
    @click.self="close"
  >
    <view
      class="confirm-sheet__panel"
      role="alertdialog"
      aria-modal="true"
      :aria-label="title"
    >
      <view class="confirm-sheet__body">
        <text class="confirm-sheet__title">{{ title }}</text>
        <view v-if="message" class="confirm-sheet__message">{{ message }}</view>
      </view>

      <view class="confirm-sheet__actions">
        <button
          type="button"
          class="confirm-sheet__btn"
          :class="tone === 'danger' ? 'confirm-sheet__btn--danger' : 'confirm-sheet__btn--primary'"
          @click="onConfirm"
        >
          {{ confirmText }}
        </button>
        <button type="button" class="confirm-sheet__btn confirm-sheet__btn--cancel" @click="close">
          {{ cancelText }}
        </button>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.confirm-sheet {
  position: fixed;
  inset: 0;
  z-index: $z-overlay;
  display: flex;
  flex-direction: column;
  justify-content: flex-end; // 面板贴底
  align-items: center;
  background-color: $color-overlay;

  // —— 关闭态（常驻 DOM，但收起：不可见、不拦截点击）——
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity $transition-base,
    visibility $transition-base;

  // —— 开启态：可见可点 + 遮罩淡入 ——
  &--open {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }

  // 面板：对齐手机画布宽度并居中，仅顶部圆角；默认下沉，开启态滑入
  &__panel {
    width: 100%;
    max-width: $layout-canvas-max-width; // 390px
    padding: $spacing-lg $spacing-sm $spacing-sm;
    padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom)); // 避让底部安全区
    background-color: $color-bg-card;
    border-top-left-radius: $radius-lg; // 16px
    border-top-right-radius: $radius-lg;
    box-shadow: $shadow-fab-neutral;
    transform: translateY(100%); // 关闭态下沉到屏幕外
    transition: transform $transition-base;
  }

  &--open &__panel {
    transform: translateY(0); // 开启态滑回原位
  }

  // 文案区
  &__body {
    @include flex-col-center;
    gap: $spacing-xs;
    padding: 0 $spacing-xs $spacing-lg;
    text-align: center;
  }

  &__title {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__message {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
  }

  // 堆叠整宽按钮
  &__actions {
    display: flex;
    flex-direction: column;
    gap: $spacing-xs;
  }

  &__btn {
    @include button-reset;
    @include flex-center;
    width: 100%;
    height: 52px;
    border-radius: $radius-md;
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    transition:
      background-color $transition-base,
      filter $transition-base,
      transform $transition-fast;

    &:active {
      transform: scale(0.99);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }

    // 危险确认（实心红）
    &--danger {
      background-color: $color-danger;
      color: $color-white;

      &:hover {
        filter: brightness(0.94);
      }
    }

    // 品牌确认（实心蓝）
    &--primary {
      background-color: $color-brand;
      color: $color-white;

      &:hover {
        filter: brightness(0.94);
      }
    }

    // 取消（中性浅底）
    &--cancel {
      background-color: $color-bg-input;
      color: $color-text-strong;

      &:hover {
        background-color: rgba($line-base, 0.25);
      }
    }
  }
}
</style>
