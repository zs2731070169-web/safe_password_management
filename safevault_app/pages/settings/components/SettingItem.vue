<script setup>
/**
 * SettingItem —— 单条设置项（设置页私有子组件，uni-app 版）
 *
 * 单行：左侧图标方块 + 标题（可选副标题），右侧随 type 变化：
 *   - toggle   ：胶囊开关（整行可点切换）
 *   - select   ：当前值文案 + 下拉箭头（整行可点，弹底部抽屉单选，点选即生效）
 *   - navigate ：可选徽章 + 右箭头（整行可点，触发 activate）
 *
 * uni 化要点（本组件改造量最大）：
 *   1. 源工程用 <component :is="type==='toggle' ? 'label' : 'button'"> 动态元素 + 隐藏 checkbox，
 *      uni 不支持动态切 label/button、也无原生 checkbox。统一改为 <view> 容器 + 整行 @click 分发：
 *        · toggle  → 取反并 emit update:modelValue（开态由 --on 类驱动 track/thumb，源已用类选择器）；
 *        · select  → 打开底部抽屉；navigate → emit activate。
 *   2. select 抽屉：源用 Teleport to="body" + document.addEventListener(ESC) + body.overflow 锁滚，
 *      App 端无 document/Teleport-to-body。改为组件内 position:fixed 全屏遮罩（fixed 相对视口、
 *      不被 SettingGroup 的 overflow:hidden 裁剪），去掉 ESC 与锁滚副作用（遮罩盖住即天然不可滚，
 *      App 无键盘 ESC）。点击遮罩收起，点选某项 emit select 并收起。
 *   3. 标签：span→text/view；自绘单选圆点（--on）保留。
 */
import { ref } from 'vue'
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
  /** 危险态：标题用危险色 */
  danger: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'activate', 'select'])

// —— select 选项：底部抽屉开合状态 ——
const open = ref(false)

/**
 * 整行点击分发：
 *   - toggle：取反开关
 *   - select：打开底部抽屉
 *   - navigate：emit activate
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
</script>

<template>
  <view
    class="setting-item"
    :class="{ 'setting-item--danger': danger }"
    @click="onActivate"
  >
    <!-- 左侧：图标方块 + 文案 -->
    <view class="setting-item__lead">
      <view class="setting-item__tile">
        <AppIcon :name="icon" :size="20" />
      </view>
      <view class="setting-item__text">
        <text class="setting-item__title">{{ title }}</text>
        <text v-if="subtitle" class="setting-item__subtitle">{{ subtitle }}</text>
      </view>
    </view>

    <!-- 右侧：随类型变化 -->
    <!-- 开关（整行点击切换，开态由 --on 类驱动 track/thumb） -->
    <view v-if="type === 'toggle'" class="setting-item__toggle">
      <view class="setting-item__track" :class="{ 'setting-item__track--on': modelValue }">
        <view class="setting-item__thumb"></view>
      </view>
    </view>

    <!-- 值选择：当前值 + 下拉箭头（展开时箭头翻转） -->
    <view v-else-if="type === 'select'" class="setting-item__trailing">
      <text class="setting-item__value">{{ value }}</text>
      <AppIcon
        name="chevron-down"
        :size="18"
        class="setting-item__arrow"
        :class="{ 'setting-item__arrow--open': open }"
      />
    </view>

    <!-- 跳转：可选徽章 + 右箭头 -->
    <view v-else class="setting-item__trailing">
      <text v-if="value" class="setting-item__badge">{{ value }}</text>
      <AppIcon name="chevron-right" :size="20" class="setting-item__arrow" />
    </view>

    <!-- select 底部抽屉单选：组件内 fixed 全屏遮罩（不被父级 overflow 裁剪），
         遮罩淡入 + 面板自底部滑入。@click.stop 防止点选/遮罩冒泡到整行 onActivate。 -->
    <view
      v-if="type === 'select' && open"
      class="option-sheet"
      @click.stop="closeMenu"
    >
      <view class="option-sheet__panel" @click.stop>
        <view class="option-sheet__header">
          <view class="option-sheet__grabber"></view>
          <text class="option-sheet__title">{{ title }}</text>
        </view>
        <view class="option-sheet__list">
          <view
            v-for="opt in options"
            :key="opt.value"
            class="option-sheet__item"
            :class="{ 'option-sheet__item--active': opt.label === value }"
            @click.stop="choose(opt)"
          >
            <text class="option-sheet__label">{{ opt.label }}</text>
            <view
              class="option-sheet__radio"
              :class="{ 'option-sheet__radio--on': opt.label === value }"
            ></view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-sm;
  width: 100%;
  min-height: $size-setting-row; // 56px，保证热区与可读
  padding: $spacing-2xs $spacing-sm; // 10 / 16
  text-align: left;
  background-color: $color-bg-card;
  box-sizing: border-box;
  transition: background-color $transition-fast;

  // 同组项之间的分隔线（首项不需要）
  & + & {
    border-top: 1px solid rgba($line-base, 0.4);
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

  // —— 开关（胶囊 + thumb，沿用 OptionSwitch 方案，整行点击驱动） ——
  &__toggle {
    position: relative;
    flex-shrink: 0;
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
}

// ---------------------------------------------------------------
// select 底部抽屉单选（组件内 fixed 全屏遮罩 + 自底部滑入面板）
// ---------------------------------------------------------------
.option-sheet {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
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
    box-sizing: border-box;
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
    display: flex;
    flex-direction: column;
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
    transition: background-color $transition-fast;

    // 项间分隔线（首项不需要）
    & + & {
      border-top: 1px solid rgba($line-base, 0.4);
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
    box-sizing: border-box;
    transition: border-color $transition-base;

    &--on {
      border-color: $color-link;

      &::after {
        content: '';
        position: absolute;
        left: 3px;
        top: 3px;
        right: 3px;
        bottom: 3px;
        border-radius: $radius-pill;
        background-color: $color-link;
      }
    }
  }
}
</style>
