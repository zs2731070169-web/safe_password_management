<script setup>
/**
 * SettingItem —— 单条设置项（设置页私有子组件）
 *
 * 单行：左侧图标方块 + 标题（可选副标题），右侧随 type 变化：
 *   - toggle   ：胶囊开关（原生 checkbox 承载语义，整行可点切换）
 *   - select   ：当前值文案 + 下拉箭头（整行可点，就地展开下拉框单选，点选即生效）
 *   - navigate ：可选徽章（如回收站「3 条」）+ 右箭头（整行可点，触发跳转 / 占位）
 *
 * 开关样式沿用生成器页 OptionSwitch 的胶囊 + ::after 手柄方案（原生 input 自定义，
 * 不引入 Element Plus 控件）。select 的选项以「底部抽屉单选」呈现：Teleport 到 body，
 * 遮罩置灰背景 + 面板自底部滑入，标题 + 整宽单选列表（选中态实心圆点），点选即生效；
 * 点击遮罩 / 按 ESC 收起，打开时锁定页面滚动。还原 DRD 4.12 设置页「开关型与跳转型混排」。
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  /** 行类型：toggle 开关 / select 值选择 / navigate 跳转 */
  type: {
    type: String,
    default: 'navigate',
    validator: (v) => ['toggle', 'select', 'navigate'].includes(v)
  },
  /** 行首图标名（AppIcon 注册名） */
  icon: {
    type: String,
    required: true
  },
  /** 标题文案 */
  title: {
    type: String,
    required: true
  },
  /** 副标题 / 说明（可选，跳转型常用） */
  subtitle: {
    type: String,
    default: ''
  },
  /** 开关状态（type=toggle 时生效） */
  modelValue: {
    type: Boolean,
    default: false
  },
  /** 右侧值文案（type=select 时显示当前选项；type=navigate 时作为徽章文案） */
  value: {
    type: String,
    default: ''
  },
  /**
   * 下拉候选项（type=select 时生效），元素形如 { value, label }。
   * 当前项以 label 与 props.value 比对高亮（各选项 label 唯一）。
   */
  options: {
    type: Array,
    default: () => []
  },
  /** 危险态：标题用危险色（如未来的「清空回收站」等） */
  danger: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'activate', 'select'])

// —— select 选项：底部抽屉开合状态 ——
const open = ref(false)

/**
 * 整行点击：
 *   - toggle：取反开关并 emit update:modelValue
 *   - select：打开底部抽屉单选
 *   - navigate：emit activate 交由父级处理（跳转 / 占位）
 */
function onActivate() {
  if (props.type === 'toggle') {
    emit('update:modelValue', !props.modelValue)
  } else if (props.type === 'select') {
    open.value = true
  } else {
    emit('activate')
  }
}

/** 收起底部抽屉 */
function closeMenu() {
  open.value = false
}

/** 点选某项：上抛其 value 并收起 */
function choose(opt) {
  emit('select', opt.value)
  closeMenu()
}

/** ESC 收起抽屉 */
function onKeydown(e) {
  if (e.key === 'Escape') closeMenu()
}

// 抽屉打开/关闭：监听 ESC 并锁定 / 恢复页面滚动
watch(open, (val) => {
  if (val) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <component
    :is="type === 'toggle' ? 'label' : 'button'"
    :type="type === 'toggle' ? undefined : 'button'"
    class="setting-item"
    :class="{ 'setting-item--danger': danger }"
    @click="type !== 'toggle' && onActivate()"
  >
    <!-- 左侧：图标方块 + 文案 -->
    <span class="setting-item__lead">
      <span class="setting-item__tile" aria-hidden="true">
        <AppIcon :name="icon" :size="20" />
      </span>
      <span class="setting-item__text">
        <span class="setting-item__title">{{ title }}</span>
        <span v-if="subtitle" class="setting-item__subtitle">{{ subtitle }}</span>
      </span>
    </span>

    <!-- 右侧：随类型变化 -->
    <!-- 开关 -->
    <span v-if="type === 'toggle'" class="setting-item__toggle">
      <input
        class="setting-item__input"
        type="checkbox"
        :checked="modelValue"
        @change="onActivate"
      />
      <span class="setting-item__track" :class="{ 'setting-item__track--on': modelValue }">
        <span class="setting-item__thumb"></span>
      </span>
    </span>

    <!-- 值选择：当前值 + 下拉箭头（展开时箭头翻转） -->
    <span v-else-if="type === 'select'" class="setting-item__trailing">
      <span class="setting-item__value">{{ value }}</span>
      <AppIcon
        name="chevron-down"
        :size="18"
        class="setting-item__arrow"
        :class="{ 'setting-item__arrow--open': open }"
      />
    </span>

    <!-- 跳转：可选徽章 + 右箭头 -->
    <span v-else class="setting-item__trailing">
      <span v-if="value" class="setting-item__badge">{{ value }}</span>
      <AppIcon name="chevron-right" :size="20" class="setting-item__arrow" />
    </span>

    <!-- select 选项：Teleport 到 body 的底部抽屉单选（遮罩 + 自底部滑入） -->
    <Teleport to="body">
      <Transition name="option-sheet">
        <div
          v-if="type === 'select' && open"
          class="option-sheet"
          @click.self="closeMenu"
        >
          <div class="option-sheet__panel" role="dialog" aria-modal="true" :aria-label="title">
            <header class="option-sheet__header">
              <span class="option-sheet__grabber" aria-hidden="true"></span>
              <h3 class="option-sheet__title">{{ title }}</h3>
            </header>
            <ul class="option-sheet__list">
              <li
                v-for="opt in options"
                :key="opt.value"
                class="option-sheet__item"
                :class="{ 'option-sheet__item--active': opt.label === value }"
                @click="choose(opt)"
              >
                <span class="option-sheet__label">{{ opt.label }}</span>
                <span
                  class="option-sheet__radio"
                  :class="{ 'option-sheet__radio--on': opt.label === value }"
                  aria-hidden="true"
                ></span>
              </li>
            </ul>
          </div>
        </div>
      </Transition>
    </Teleport>
  </component>
</template>

<style lang="scss" scoped>
.setting-item {
  @include button-reset;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-sm;
  width: 100%;
  min-height: $size-setting-row; // 56px，保证热区与可读
  padding: $spacing-2xs $spacing-sm; // 10 / 16
  text-align: left;
  background-color: $color-bg-card;
  cursor: pointer;
  transition: background-color $transition-fast;

  // 同组项之间的分隔线（首项不需要）
  & + & {
    border-top: 1px solid rgba($line-base, 0.4);
  }

  &:hover {
    background-color: rgba($color-brand, 0.03);
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: -2px;
  }

  // —— 左侧：图标方块 + 文案 ——
  &__lead {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  &__tile {
    @include flex-center;
    flex-shrink: 0;
    width: $size-setting-icon-tile; // 36px
    height: $size-setting-icon-tile;
    border-radius: $radius-sm;
    background-color: $color-bg-input; // #f0f3ff
    color: $color-link;
  }

  &__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    @include text-ellipsis;
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    color: $color-text-strong;
  }

  &__subtitle {
    @include text-ellipsis;
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-text-muted;
  }

  // —— 右侧通用容器 ——
  &__trailing {
    display: flex;
    align-items: center;
    gap: $spacing-xxs; // 4px
    flex-shrink: 0;
  }

  &__value {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-muted;
  }

  &__arrow {
    flex-shrink: 0;
    color: $color-text-placeholder;
    transition: transform $transition-base;

    // 下拉框展开时箭头翻转
    &--open {
      transform: rotate(180deg);
    }
  }

  // 徽章（如回收站「3 条」）
  &__badge {
    padding: 1px 8px;
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-danger;
    background-color: $color-danger-soft;
    border-radius: $radius-pill;
  }

  // —— 危险态：标题 + 图标用危险色 ——
  &--danger {
    .setting-item__title {
      color: $color-danger;
    }
    .setting-item__tile {
      color: $color-danger;
      background-color: $color-danger-soft;
    }
  }

  // —— 开关（胶囊 + ::after 手柄，沿用 OptionSwitch 方案） ——
  &__toggle {
    position: relative;
    flex-shrink: 0;
  }

  // 真正的 checkbox 隐藏，仅用于无障碍 / 键盘聚焦
  &__input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  &__track {
    position: relative;
    display: block;
    width: 44px;
    height: 24px;
    border-radius: $radius-pill;
    background-color: $color-border; // 关
    transition: background-color $transition-base;

    &--on {
      background-color: $color-link; // 开：#004ac6

      .setting-item__thumb {
        transform: translateX(20px); // 44 - 2*2 - 20
      }
    }
  }

  &__thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: $radius-pill;
    background-color: $color-white;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    transition: transform $transition-base;
  }

  &__input:focus-visible + .setting-item__track {
    outline: 2px solid rgba($color-brand, 0.5);
    outline-offset: 2px;
  }
}

// ---------------------------------------------------------------
// select 底部抽屉单选（Teleport 到 body，遮罩 + 自底部滑入面板）
// scoped 的属性选择器对 Teleport 内容同样生效，故样式留在本组件内。
// ---------------------------------------------------------------
.option-sheet {
  position: fixed;
  inset: 0;
  z-index: $z-overlay; // 高于常驻底栏 / 内容层
  display: flex;
  flex-direction: column;
  justify-content: flex-end; // 面板贴底
  align-items: center;
  background-color: $color-overlay;

  // 面板：对齐手机画布宽度并居中，仅顶部圆角
  &__panel {
    width: 100%;
    max-width: $layout-canvas-max-width; // 390px
    padding: $spacing-xs $spacing-sm $spacing-sm;
    padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom)); // 避让底部安全区
    background-color: $color-bg-card;
    border-top-left-radius: $radius-lg; // 16px
    border-top-right-radius: $radius-lg;
    box-shadow: $shadow-fab-neutral;
  }

  // 头部：拖拽条 + 标题
  &__header {
    @include flex-col-center;
    gap: $spacing-xs;
    padding-bottom: $spacing-xs;
  }

  &__grabber {
    width: 36px;
    height: 4px;
    border-radius: $radius-pill;
    background-color: $color-border;
  }

  &__title {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $spacing-sm;
    min-height: 52px; // 充裕命中区
    padding: $spacing-xs $spacing-2xs;
    font-size: $font-size-body; // 16px
    line-height: $line-height-body;
    color: $color-text-strong;
    cursor: pointer;
    transition: background-color $transition-fast;

    // 项间分隔线（首项不需要）
    & + & {
      border-top: 1px solid rgba($line-base, 0.4);
    }

    &:hover {
      background-color: rgba($color-brand, 0.04);
    }

    // 当前选中项：品牌色文字
    &--active {
      color: $color-link;
      font-weight: $font-weight-medium;
    }
  }

  // 单选圆点：未选空心环，选中描边 + 实心内点
  &__radio {
    position: relative;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border: 2px solid $color-border;
    border-radius: $radius-pill;
    transition: border-color $transition-base;

    &--on {
      border-color: $color-link;

      &::after {
        content: '';
        position: absolute;
        inset: 3px;
        border-radius: $radius-pill;
        background-color: $color-link;
      }
    }
  }
}

// ---- 抽屉进出场：遮罩淡入 + 面板自底部滑入 ----
.option-sheet-enter-active,
.option-sheet-leave-active {
  transition: opacity $transition-base;
}

.option-sheet-enter-active .option-sheet__panel,
.option-sheet-leave-active .option-sheet__panel {
  transition: transform $transition-base;
}

.option-sheet-enter-from,
.option-sheet-leave-to {
  opacity: 0;
}

.option-sheet-enter-from .option-sheet__panel,
.option-sheet-leave-to .option-sheet__panel {
  transform: translateY(100%);
}
</style>
