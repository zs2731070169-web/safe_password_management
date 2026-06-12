<script setup>
/**
 * AppHeader —— 全局统一顶部 AppBar（库页 / 健康页共用）
 *
 * 默认态：线性盾牌图标 +「密码安全助手」品牌字 + 右侧圆形搜索按钮。
 * 搜索态：点击搜索按钮就地展开搜索输入框（自动聚焦），可清空 / 取消收起。
 * 关键词通过 v-model 双向绑定到各页 store（库：按名称/账号搜；健康：按问题项搜）。
 * 还原 Figma node 1:470（Header - TopAppBar），由原 HealthHeader 抽象而来。
 */
import { ref, watch } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

/** 搜索关键词（双向绑定到所在页的 store） */
const keyword = defineModel({ type: String, default: '' })

const props = defineProps({
  /** 搜索框占位文案（各页语义不同） */
  placeholder: {
    type: String,
    default: '搜索'
  },
  /** 搜索的无障碍标签 */
  searchLabel: {
    type: String,
    default: '搜索'
  },
  /** 是否显示搜索功能（无搜索语义的 Tab，如生成规则，可置 false 隐藏右上角搜索入口） */
  searchable: {
    type: Boolean,
    default: true
  }
})

/** 是否处于搜索展开态（同时驱动 input 的 :focus 属性自动聚焦，替代 DOM .focus()） */
const expanded = ref(false)

/** 展开搜索框 */
function open() {
  expanded.value = true
}

/** 收起搜索框并清空关键词 */
function close() {
  expanded.value = false
  keyword.value = ''
}

/** 清空关键词（保持展开，便于继续输入；展开态下 input 仍持有焦点） */
function clearKeyword() {
  keyword.value = ''
}

// 顶栏现跨 Tab 常驻（home 单页 swiper 外壳）：从可搜 Tab 滑到不可搜 Tab（生成 / 设置）时，
// searchable 转 false，自动收起残留的搜索展开态并清空关键词，避免无搜索语义的 Tab 顶部还挂着输入框。
watch(
  () => props.searchable,
  (searchable) => {
    if (!searchable && expanded.value) close()
  }
)
</script>

<template>
  <view class="app-header">
    <!-- 默认态：品牌 + 搜索入口 -->
    <template v-if="!expanded">
      <view class="app-header__brand">
        <AppIcon name="shield" :width="16" :height="20" />
        <text class="app-header__title">密码安全助手</text>
      </view>

      <button
        v-if="props.searchable"
        type="button"
        class="app-header__search-btn"
        :aria-label="props.searchLabel"
        @click="open"
      >
        <AppIcon name="search" :size="18" />
      </button>
    </template>

    <!-- 搜索态：展开输入框（标记为忽略区，避免输入时误触滑动翻页） -->
    <view v-else class="app-header__search" data-swipe-ignore>
      <AppIcon name="search" :size="18" class="app-header__search-icon" />
      <!-- uni input：type 仅支持 text，type=search/autocomplete/keydown 等 Web 属性不可用；
           聚焦改用 :focus 属性（替代 DOM 的 .focus()），回车类型用 confirm-type。
           @blur 触发收起（与源工程一致）；ESC 收起为浏览器键盘行为，移动端无键盘 ESC，故移除。 -->
      <input
        v-model="keyword"
        class="app-header__input"
        :placeholder="props.placeholder"
        :focus="expanded"
        confirm-type="search"
        :adjust-position="false"
        @blur="close"
      />
      <button
        v-show="keyword"
        type="button"
        class="app-header__clear"
        aria-label="清空搜索"
        @click="clearKeyword"
      >
        <AppIcon name="close" :size="18" />
      </button>
      <button
        type="button"
        class="app-header__cancel"
        aria-label="关闭搜索"
        @click="close"
      >
        取消
      </button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-xs;
  height: calc(#{$layout-tabbar-height} + #{$safe-area-top}); // 64px
  padding: #{$safe-area-top} $layout-page-padding 0; // 避让刘海/状态栏
  background-color: $color-bg-header;

  &__brand {
    display: flex;
    align-items: center;
    gap: 12px;
    color: $color-link;
  }

  &__title {
    font-size: $font-size-logo;
    font-weight: $font-weight-bold;
    line-height: $line-height-logo;
    color: $color-link;
    white-space: nowrap;
  }

  // 搜索按钮（默认态）
  &__search-btn {
    @include button-reset;
    @include flex-center;
    width: 40px;
    height: 40px;
    border-radius: $radius-pill;
    color: $color-text-strong;
    transition: background-color $transition-base;

    &:hover {
      background-color: rgba($color-brand, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }

  // 搜索输入容器（搜索态）
  &__search {
    display: flex;
    align-items: center;
    flex: 1;
    height: 40px;
    padding: 0 $spacing-2xs;
    background-color: $color-bg-input;
    border-radius: $radius-pill;
    transition: box-shadow $transition-base;

    &:focus-within {
      box-shadow: 0 0 0 1px $color-brand;
    }
  }

  &__search-icon {
    flex-shrink: 0;
    color: $color-text-muted;
  }

  &__input {
    @include button-reset;
    flex: 1;
    min-width: 0;
    height: 100%;
    margin-left: $spacing-xs;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-strong;
    cursor: text;

    &::placeholder {
      color: $color-text-placeholder;
    }

    &::-webkit-search-decoration,
    &::-webkit-search-cancel-button {
      -webkit-appearance: none;
    }
  }

  &__clear {
    @include button-reset;
    @include flex-center;
    flex-shrink: 0;
    color: $color-text-placeholder;
    transition: color $transition-base;

    &:hover {
      color: $color-text-muted;
    }
  }

  // 取消按钮（收起搜索）
  &__cancel {
    @include button-reset;
    flex-shrink: 0;
    margin-left: $spacing-xs;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-link;
    white-space: nowrap;

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }
}
</style>
