<script setup>
/**
 * 分类管理（独立右侧弹出 SHEET 页）—— uni-app 版
 *
 * 入口：设置「数据 → 分类管理」。集中管理密码库的分类标签，补齐过去只能「新建」、
 * 无法改名 / 删除 / 排序的缺口。结构（自上而下，沿用项目 header / main 滚动三段式）：
 *   1. 顶部导航：返回 + 标题「分类管理」
 *   2. 说明条：阐明删除分类不会删条目，仅落为「未分类」
 *   3. 分类列表：点名称就地改名 + 条目数 + 上/下移 + 删除
 *   4. 底部新建行：输入名称即可新增分类
 *
 * 交互编排复用 useCategories（增删改排 + 重名/空名校验 + 反馈）；
 * 改动随云备份快照（含 categories）同步，无需额外持久化。
 *
 * —— 自源 views/categories/CategoryManageView.vue 迁移 ——
 *   - vue-router(router.back/replace) → navBack；标签 div/header/main/ul/li/h1/span/p → view/text；
 *   - 改名输入框：源用函数式 :ref + nextTick(.focus())，uni input 无 DOM 实例，
 *     改用 uni input 的 :focus 属性（绑 editingKey===item.key，进入编辑态即自动聚焦）；
 *   - input 取值：v-model 两端均支持予以保留，blur 提交时从 e.detail.value 兜底取值；
 *   - @keydown.enter → @confirm；@keydown.esc 无对应（移动端无 ESC 键）故移除；
 *   - 移除 autocomplete 等 Web 专属属性；触摸事件去掉 .passive 修饰符。
 */
import { ref, reactive } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import { useCategories } from '@/composables/useCategories'
import { useSheetDismiss } from '@/composables/useSheetDismiss'
import { navBack } from '@/utils/navigation'

const { manageableCategories, add, rename, remove, move } = useCategories()

/** 正在改名的分类 key（空串表示无）与编辑中的文本 */
const editingKey = ref('')
const editingText = ref('')

/** 新建分类输入值 */
const newLabel = ref('')

/** 删除确认面板状态：暂存待删分类 */
const confirm = reactive({ visible: false, target: null })

/** 进入某分类的改名态：回填当前名（输入框经 :focus 自动聚焦，无需手动 DOM 操作） */
function startEdit(category) {
  editingKey.value = category.key
  editingText.value = category.label
}

/**
 * 提交改名：成功或重名失败都退出编辑态（失败时 useCategories 已提示，保留原名）。
 * @param {object} category 当前分类
 * @param {Event} [e] uni input 的 blur/confirm 事件，从 e.detail.value 兜底取最新值
 */
function commitEdit(category, e) {
  if (!editingKey.value) return // 已被取消，避免 blur 重复触发
  // v-model 通常已同步，但 blur 时偶有时序差，优先用事件携带的最新值兜底
  const raw = e?.detail?.value ?? editingText.value
  const text = (raw ?? '').trim()
  if (text && text !== category.label) {
    rename(category.key, text)
  }
  cancelEdit()
}

/** 取消改名 */
function cancelEdit() {
  editingKey.value = ''
  editingText.value = ''
}

/** 唤起删除确认面板 */
function askRemove(category) {
  confirm.target = category
  confirm.visible = true
}

/** 删除确认面板文案：有条目时告知将落为未分类 */
function confirmMessage() {
  const c = confirm.target
  if (!c) return ''
  return c.count > 0
    ? `「${c.label}」下的 ${c.count} 条密码将变为「未分类」（不会被删除）。`
    : `确认删除分类「${c.label}」？`
}

/** 执行删除 */
function onConfirmRemove() {
  if (confirm.target) remove(confirm.target)
}

/** 新建分类：成功后清空输入框 */
function onAdd() {
  if (add(newLabel.value)) newLabel.value = ''
}

/** 返回设置页（uni 页面栈回退，触发 pop-out 右滑回过渡） */
function handleBack() {
  navBack()
}

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回
const { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useSheetDismiss({
  onDismiss: handleBack
})
</script>

<template>
  <view
    class="cat-page"
    ref="sheetRoot"
    :style="sheetStyle"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <!-- 顶部导航 -->
    <view class="cat-header">
      <button type="button" class="cat-header__back" aria-label="返回" @click="handleBack">
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <text class="cat-header__title">分类管理</text>
      <view class="cat-header__placeholder" aria-hidden="true"></view>
    </view>

    <view class="cat-page__main">
      <!-- 说明条（混排文本整体包进 text，App 端 view 直接子文本不渲染） -->
      <view class="cat-note">
        <AppIcon name="info" :width="14" :height="14" class="cat-note__icon" />
        <text>删除分类不会删除密码，仅把该分类下的密码移为未分类</text>
      </view>

      <!-- 分类列表 -->
      <view v-if="manageableCategories.length" class="cat-list">
        <view v-for="item in manageableCategories" :key="item.key" class="cat-card">
          <!-- 名称区：默认按钮（点按进入改名），编辑态切换为输入框（:focus 自动聚焦） -->
          <input
            v-if="editingKey === item.key"
            v-model="editingText"
            class="cat-card__input"
            :focus="editingKey === item.key"
            maxlength="12"
            confirm-type="done"
            @confirm="commitEdit(item, $event)"
            @blur="commitEdit(item, $event)"
          />
          <button
            v-else
            type="button"
            class="cat-card__name"
            @click="startEdit(item)"
          >
            <text class="cat-card__label">{{ item.label }}</text>
            <text class="cat-card__count">{{ item.count }} 条</text>
          </button>

          <!-- 操作区：上移 / 下移 / 删除 -->
          <view class="cat-card__actions">
            <button
              type="button"
              class="cat-card__btn"
              aria-label="上移"
              :disabled="item.isFirst"
              @click="move(item.key, 'up')"
            >
              <AppIcon name="chevron-down" :size="18" class="cat-card__icon--up" />
            </button>
            <button
              type="button"
              class="cat-card__btn"
              aria-label="下移"
              :disabled="item.isLast"
              @click="move(item.key, 'down')"
            >
              <AppIcon name="chevron-down" :size="18" />
            </button>
            <button
              type="button"
              class="cat-card__btn cat-card__btn--danger"
              aria-label="删除"
              @click="askRemove(item)"
            >
              <AppIcon name="trash" :width="14" :height="15.75" />
            </button>
          </view>
        </view>
      </view>

      <text v-else class="cat-empty">还没有分类，在下方新建一个吧。</text>

      <!-- 底部新建行 -->
      <view class="cat-create">
        <input
          v-model="newLabel"
          class="cat-create__input"
          placeholder="新建分类，如「游戏」"
          maxlength="12"
          confirm-type="done"
          @confirm="onAdd"
        />
        <button
          type="button"
          class="cat-create__btn"
          :disabled="!newLabel.trim()"
          @click="onAdd"
        >
          <AppIcon name="plus" :size="16" />
          <text>新建</text>
        </button>
      </view>
    </view>

    <!-- 删除确认面板 -->
    <ConfirmSheet
      v-model="confirm.visible"
      title="删除分类"
      :message="confirmMessage()"
      confirm-text="删除"
      tone="danger"
      @confirm="onConfirmRemove"
    />
  </view>
</template>

<style lang="scss" scoped>
.cat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: $color-bg-page;
  overflow: hidden;

  &__main {
    flex: 1;
    min-height: 0; // 允许 flex 子项收缩，内部 overflow 才生效
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-sm $spacing-sm $spacing-2xl;
  }
}

// ---- 顶部导航（与回收站同构）----
.cat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-xs;
  height: calc(#{$layout-header-height} + #{$safe-area-top});
  padding: #{$safe-area-top} $spacing-sm 0;
  background-color: $color-bg-header;

  &__back {
    @include button-reset;
    @include flex-center;
    @include circle($size-touch-min);
    flex-shrink: 0;
    color: $color-link;
    transition: background-color $transition-base;

    &:hover {
      background-color: rgba($color-link, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-link, 0.4);
      outline-offset: 2px;
    }
  }

  &__title {
    flex: 1;
    text-align: center;
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  // 占位：与返回按钮对称，标题保持居中
  &__placeholder {
    flex-shrink: 0;
    width: $size-touch-min;
  }
}

// ---- 说明条（与回收站说明条同款）----
.cat-note {
  display: flex;
  align-items: flex-start;
  gap: $spacing-xs;
  padding: $spacing-xs $spacing-2xs;
  background-color: $color-bg-input;
  border-radius: $radius-sm;
  font-size: $font-size-caption; // 12px
  line-height: $line-height-caption;
  color: $color-text-muted;

  &__icon {
    flex-shrink: 0;
    margin-top: 1px;
    color: $color-text-placeholder;
  }
}

// ---- 分类列表 ----
.cat-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
  margin: 0;
  padding: 0;
}

.cat-card {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  padding: $spacing-2xs $spacing-sm;
  background-color: $color-bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  // 名称区：整宽可点按，点击进入改名
  &__name {
    @include button-reset;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $spacing-xs;
    flex: 1;
    min-width: 0;
    height: 44px;
    text-align: left;
    transition: opacity $transition-base;

    &:active {
      opacity: 0.6;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
      border-radius: $radius-sm;
    }
  }

  &__label {
    @include text-ellipsis;
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    color: $color-text-strong;
  }

  // 条目数徽标：弱化展示，不抢名称焦点
  &__count {
    flex-shrink: 0;
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-text-placeholder;
  }

  // 改名输入框：占据名称区位置，视觉与输入框一致
  &__input {
    @include button-reset;
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 $spacing-xs;
    background-color: $color-bg-input;
    border: 1px solid $color-brand;
    border-radius: $radius-sm;
    font-size: $font-size-body; // 16px
    color: $color-text-strong;
    cursor: text;

    &:focus {
      box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: $spacing-xxs;
    flex-shrink: 0;
  }

  // 操作图标按钮
  &__btn {
    @include button-reset;
    @include flex-center;
    @include circle($size-touch-min);
    color: $color-text-muted;
    transition:
      background-color $transition-base,
      color $transition-base,
      opacity $transition-base;

    &:hover:not(:disabled) {
      background-color: rgba($line-base, 0.18);
      color: $color-text-regular;
    }

    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }

    // 删除：危险色
    &--danger {
      color: $color-danger;

      &:hover:not(:disabled) {
        background-color: rgba($color-danger, 0.08);
        color: $color-danger;
      }
    }
  }

  // 「上移」复用 chevron-down 图标旋转 180°
  &__icon--up {
    transform: rotate(180deg);
  }
}

// ---- 空态 ----
.cat-empty {
  display: block;
  padding: $spacing-2xl 0;
  text-align: center;
  font-size: $font-size-sm;
  line-height: $line-height-sm;
  color: $color-text-placeholder;
}

// ---- 底部新建行 ----
.cat-create {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  margin-top: $spacing-xs;

  &__input {
    @include button-reset;
    flex: 1;
    min-width: 0;
    height: 50px;
    padding: 0 $spacing-sm;
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-md;
    font-size: $font-size-body; // 16px
    color: $color-text-strong;
    cursor: text;
    transition:
      border-color $transition-base,
      box-shadow $transition-base;

    &::placeholder {
      color: $color-text-placeholder;
    }

    &:focus {
      border-color: $color-brand;
      box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
    }
  }

  &__btn {
    @include button-reset;
    @include flex-center;
    flex-shrink: 0;
    gap: $spacing-xxs;
    height: 50px;
    padding: 0 $spacing-md;
    border-radius: $radius-md;
    background-color: $color-brand;
    font-size: $font-size-sm; // 14px
    font-weight: $font-weight-medium;
    color: $color-white;
    transition:
      filter $transition-base,
      opacity $transition-base;

    &:hover:not(:disabled) {
      filter: brightness(0.94);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 3px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }
}
</style>
