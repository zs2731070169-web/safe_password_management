<script setup>
/**
 * CategorySelect —— 分类选择字段（chips 标签式，uni-app 版）
 *
 * 设计取舍：分类数量很少，本质是「从既有里挑一个，或新建一个」。
 * 移动端「输入框 + 下拉浮层」混合控件会让聚焦/软键盘/浮层互相打架，体验割裂，
 * 故改为 chips 标签式——
 *   · 点 chip = 纯「选择」，走按钮，永不弹软键盘；再点一次取消选择（分类可空）。
 *   · 点「+ 新建」才进入输入态，显式表达「输入」意图，此时才弹键盘。
 * 两种意图彻底分离，移动端操作顺滑、不再误弹键盘。
 *
 * 本组件只负责把选中 / 新建的分类**文本**通过 v-model 上抛，不直接建组；
 * 真正的「创建分类」在表单保存时由父级解析处理（见 add/index.vue）。
 *
 * 迁移要点（HTML input → uni input）：
 *   - 自动聚焦 inputRef.focus() → uni input 的 :focus 属性（绑定 creating，进入输入态即聚焦）；
 *     不再需要 DOM .blur()，退出输入态时 input 随 v-else 卸载，聚焦自然解除；
 *   - 取值 @input 取 e.detail.value；@keydown.enter → @confirm；@keydown.esc 移动端无键，去除
 *     （取消改由「取消」按钮触发）；
 *   - placeholder 颜色用 placeholder-style 内联（uni input ::placeholder 无效）。
 */
import { ref, computed } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  /** 受控值（v-model），存分类文本 */
  modelValue: {
    type: String,
    default: ''
  },
  /** 候选分类标签列表 */
  options: {
    type: Array,
    default: () => []
  },
  /** 禁用态 */
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

/** 是否处于「新建分类」输入态（同时驱动 uni input 的 :focus 自动聚焦） */
const creating = ref(false)
/** 进入输入态前的选中值，取消时用于还原 */
const prevValue = ref('')

/**
 * 实际渲染的 chips：既有候选 + 一个「当前自定义值」。
 * 编辑旧条目或刚新建时，分类可能尚未并入 options，补一枚高亮 chip 以正确回显。
 */
const chips = computed(() => {
  const value = props.modelValue.trim()
  if (value && !props.options.includes(value)) {
    return [...props.options, value]
  }
  return props.options
})

/** 点选 chip：再次点击已选中项则取消选择（分类可空） */
function selectChip(label) {
  if (props.disabled) return
  creating.value = false
  emit('update:modelValue', label === props.modelValue ? '' : label)
}

/** 进入新建输入态：清空当前值，input 随 v-else 渲染并经 :focus 自动聚焦 */
function startCreate() {
  if (props.disabled) return
  prevValue.value = props.modelValue
  emit('update:modelValue', '')
  creating.value = true
}

function onInput(event) {
  emit('update:modelValue', event.detail?.value ?? event.target?.value ?? '')
}

/** 完成新建：退出输入态，已输入文本即为选中分类（保存时建组） */
function finishCreate() {
  creating.value = false
}

/** 取消新建：还原进入前的选中值 */
function cancelCreate() {
  emit('update:modelValue', prevValue.value)
  creating.value = false
}
</script>

<template>
  <view class="cat-field">
    <text class="cat-field__label">分类</text>

    <!-- 标签选择区：点选既有分类，或点「+ 新建」 -->
    <view v-if="!creating" class="cat-field__chips">
      <button
        v-for="label in chips"
        :key="label"
        type="button"
        class="cat-field__chip"
        :class="{ 'is-active': label === modelValue }"
        :disabled="disabled"
        @click="selectChip(label)"
      >
        {{ label }}
      </button>

      <button
        type="button"
        class="cat-field__chip cat-field__chip--new"
        :disabled="disabled"
        @click="startCreate"
      >
        <AppIcon name="plus" :size="16" />
        <text>新建</text>
      </button>
    </view>

    <!-- 新建输入态：显式输入新分类名 -->
    <view v-else class="cat-field__create">
      <input
        class="cat-field__input"
        :value="modelValue"
        :focus="creating"
        placeholder="输入新分类名"
        placeholder-style="color: #b4bccb;"
        maxlength="12"
        :disabled="disabled"
        @input="onInput"
        @confirm="finishCreate"
      />
      <button
        type="button"
        class="cat-field__create-cancel"
        aria-label="取消新建"
        @click="cancelCreate"
      >
        <AppIcon name="close" :size="18" />
      </button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.cat-field {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs; // 8px
  width: 100%;

  &__label {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-regular;
  }

  // 标签选择区：自动换行，chip 胶囊风格（与库页分类筛选同一视觉语言）
  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: $spacing-xs;
  }

  &__chip {
    @include button-reset;
    flex-shrink: 0;
    padding: $spacing-xs 18px;
    border-radius: $radius-pill;
    background-color: $color-brand-pale;
    font-size: $font-size-sm; // 14px
    color: $color-text-regular;
    white-space: nowrap;
    user-select: none;
    transition:
      background-color $transition-base,
      color $transition-base;

    // 选中态：品牌蓝实底白字
    &.is-active {
      background-color: $color-brand;
      color: $color-white;
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }

    // 「+ 新建」chip：虚线描边、透明底，区分于可选分类
    &--new {
      display: inline-flex;
      align-items: center;
      gap: $spacing-xxs;
      padding-left: 14px;
      padding-right: 16px;
      background-color: transparent;
      border: 1px dashed $color-border;
      color: $color-text-muted;
    }
  }

  // 新建输入态：输入框 + 取消
  &__create {
    display: flex;
    align-items: center;
    gap: $spacing-xs;
  }

  &__input {
    @include button-reset;
    flex: 1;
    min-width: 0;
    height: 50px;
    padding: 0 $spacing-sm;
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-md; // 12px
    font-size: $font-size-body; // 16px
    color: $color-text-strong;
    cursor: text;
    transition:
      border-color $transition-base,
      box-shadow $transition-base;

    &:focus {
      border-color: $color-brand;
      box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  &__create-cancel {
    @include button-reset;
    @include flex-center;
    flex-shrink: 0;
    width: 40px;
    height: 50px;
    color: $color-text-muted;
    transition: color $transition-base;

    &:active {
      color: $color-text-regular;
    }
  }
}
</style>
