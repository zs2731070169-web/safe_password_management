<script setup>
/**
 * CategorySelect —— 分类「可选可输入」下拉字段
 *
 * 像素级还原 Figma node 1:409「Category」。
 * 用自定义浮层替代原生 <datalist>（datalist 在桌面浏览器存在「点开即关」的怪异行为，
 * 且样式不可控）。支持：点击展开候选、点选填入、自由输入新分类、点击外部关闭。
 *
 * 注意：本组件只负责把用户选中 / 输入的分类**文本**通过 v-model 上抛，
 * 不直接建组。真正的「创建分类」在表单点击保存时由父级解析处理（见 AddPasswordView）。
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

/** 浮层是否展开 */
const open = ref(false)

/**
 * 浮层候选：始终按当前输入过滤（输入为空时展示全部）。
 * 输入的新标签匹配不到任何分组时，filtered 为空，浮层不显示。
 */
const filtered = computed(() => {
  const kw = props.modelValue.trim().toLowerCase()
  if (!kw) return props.options
  return props.options.filter((label) => label.toLowerCase().includes(kw))
})

function onInput(event) {
  emit('update:modelValue', event.target.value)
  open.value = true
}

/** 点选候选项填入并关闭 */
function selectOption(label) {
  emit('update:modelValue', label)
  open.value = false
}

/** 回车提交：收起浮层即可，分类文本已随输入实时上抛，建组在保存时处理 */
function onEnter() {
  open.value = false
}

/** 切换浮层（点击右侧箭头） */
function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

/** 失焦延迟关闭，给候选项的点击留出时机 */
function onBlur() {
  setTimeout(() => {
    open.value = false
  }, 120)
}
</script>

<template>
  <div class="cat-field">
    <label class="cat-field__label" for="cat-input">分类</label>

    <div class="cat-field__control">
      <input
        id="cat-input"
        class="cat-field__input"
        :value="modelValue"
        placeholder="选择或输入分类"
        autocomplete="off"
        :disabled="disabled"
        @input="onInput"
        @focus="open = true"
        @click="open = true"
        @blur="onBlur"
        @keydown.enter.prevent="onEnter"
      />
      <button
        type="button"
        class="cat-field__chevron"
        :class="{ 'is-open': open }"
        aria-label="展开分类"
        tabindex="-1"
        :disabled="disabled"
        @click="toggle"
      >
        <AppIcon name="chevron-down" :size="20" />
      </button>

      <!-- 候选浮层：仅在有匹配候选时出现；输入全新分类不弹浮层 -->
      <ul v-if="open && filtered.length" class="cat-field__menu">
        <li
          v-for="label in filtered"
          :key="label"
          class="cat-field__option"
          :class="{ 'is-active': label === modelValue }"
          @mousedown.prevent="selectOption(label)"
        >
          {{ label }}
        </li>
      </ul>
    </div>

    <p class="cat-field__hint">如果分类不存在，请直接输入以创建新分类。</p>
  </div>
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

  &__control {
    position: relative;
    width: 100%;
  }

  &__input {
    @include button-reset;
    width: 100%;
    height: 50px;
    padding: 0 44px 0 $spacing-sm + 1px; // 右留箭头位 / 左 17px
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-md; // 12px
    font-size: $font-size-body; // 16px
    color: $color-text-strong;
    cursor: text;
    transition:
      border-color $transition-base,
      box-shadow $transition-base;

    &::placeholder {
      color: $color-text-muted;
    }

    &:focus {
      border-color: $color-brand;
      box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  // 右侧下拉箭头按钮
  &__chevron {
    @include button-reset;
    @include flex-center;
    position: absolute;
    top: 50%;
    right: $spacing-xs;
    transform: translateY(-50%);
    width: 32px;
    height: 32px;
    color: $color-text-muted;
    transition:
      color $transition-base,
      transform $transition-base;

    // 展开时箭头翻转
    &.is-open {
      color: $color-brand;
      transform: translateY(-50%) rotate(180deg);
    }
  }

  // 候选浮层
  &__menu {
    position: absolute;
    top: calc(100% + #{$spacing-xxs});
    left: 0;
    right: 0;
    z-index: $z-content + 2;
    max-height: 200px;
    margin: 0;
    padding: $spacing-xxs;
    list-style: none;
    background-color: $color-bg-card;
    border: 1px solid $color-border;
    border-radius: $radius-md;
    box-shadow: $shadow-fab-neutral;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  &__option {
    padding: $spacing-xs $spacing-2xs; // 8 / 12
    border-radius: $radius-sm;
    font-size: $font-size-body; // 16px
    color: $color-text-strong;
    cursor: pointer;
    transition: background-color $transition-fast;

    &:hover {
      background-color: $color-bg-input;
    }

    &.is-active {
      background-color: $color-brand-soft;
      color: $color-brand;
    }
  }

  &__hint {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-muted;
  }
}
</style>
