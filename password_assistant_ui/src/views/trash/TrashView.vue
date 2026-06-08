<script setup>
/**
 * TrashView —— 回收站（独立全屏页）
 *
 * 入口：设置「数据 → 回收站」。承载被软删除的密码条目：可逐条恢复 / 彻底删除，或一键清空。
 * 结构（自上而下）：
 *   1. 顶部导航：返回 + 标题「回收站」+ 清空（仅非空时显示，危险色）
 *   2. 保留窗口说明条：「删除的密码将在 N 天后永久删除」
 *   3. 条目列表：图标字标 + 平台名 / 账号（按设置脱敏）+ 剩余天数徽标 + 恢复 / 彻底删除
 *   4. 空态：插画图标 + 文案
 *
 * 交互编排复用 useTrash（恢复反馈 / 危险确认 / 剩余天数派生）；删除条目从详情页软删除后流入此处。
 */
import { reactive } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/icons/AppIcon.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import { useTrash } from '@/composables/useTrash'
import { useSheetDismiss } from '@/composables/useSheetDismiss'

const router = useRouter()
const {
  trashedEntries,
  isEmpty,
  retentionDays,
  displayAccount,
  remainingDays,
  isExpiring,
  restore,
  purge,
  empty
} = useTrash()

/**
 * 底部确认面板状态（彻底删除 / 清空共用一个 ConfirmSheet）。
 * onConfirm 暂存「确认通过后要执行的动作」，由面板 @confirm 触发。
 */
const confirm = reactive({
  visible: false,
  title: '',
  message: '',
  confirmText: '',
  onConfirm: null
})

/** 唤起「彻底删除单条」确认面板 */
function askPurge(entry) {
  confirm.title = '彻底删除'
  confirm.message = `「${entry.name}」将被永久删除且无法恢复。`
  confirm.confirmText = '永久删除'
  confirm.onConfirm = () => purge(entry)
  confirm.visible = true
}

/** 唤起「清空回收站」确认面板 */
function askEmpty() {
  confirm.title = '清空回收站'
  confirm.message = `回收站内 ${trashedEntries.value.length} 条密码将被永久删除且无法恢复。`
  confirm.confirmText = '清空'
  confirm.onConfirm = empty
  confirm.visible = true
}

/** 面板确认：执行暂存动作 */
function onConfirm() {
  confirm.onConfirm?.()
}

/** 返回：有历史则后退，否则回设置页 */
function handleBack() {
  if (window.history.length > 1) router.back()
  else router.replace({ name: 'Settings' })
}

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回
const { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd } = useSheetDismiss({
  onDismiss: handleBack
})
</script>

<template>
  <div
    class="trash-page"
    ref="sheetRoot"
    :style="sheetStyle"
    @touchstart.passive="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- 顶部导航 -->
    <header class="trash-header">
      <button type="button" class="trash-header__back" aria-label="返回" @click="handleBack">
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <h1 class="trash-header__title">回收站</h1>
      <button
        v-if="!isEmpty"
        type="button"
        class="trash-header__clear"
        @click="askEmpty"
      >
        清空
      </button>
      <span v-else class="trash-header__placeholder" aria-hidden="true"></span>
    </header>

    <main class="trash-page__main">
      <!-- 保留窗口说明 -->
      <p v-if="!isEmpty" class="trash-note">
        <AppIcon name="info" :width="14" :height="14" class="trash-note__icon" />
        <span>删除的密码将在 {{ retentionDays }} 天后永久删除，期间可恢复。</span>
      </p>

      <!-- 条目列表 -->
      <ul v-if="!isEmpty" class="trash-list">
        <li v-for="entry in trashedEntries" :key="entry.id" class="trash-card">
          <span class="trash-card__tile" aria-hidden="true">{{ entry.monogram }}</span>

          <div class="trash-card__info">
            <span class="trash-card__name">{{ entry.name }}</span>
            <span class="trash-card__account">{{ displayAccount(entry.account) }}</span>
            <span
              class="trash-card__remain"
              :class="{ 'trash-card__remain--expiring': isExpiring(entry.deletedAt) }"
            >
              剩 {{ remainingDays(entry.deletedAt) }} 天
            </span>
          </div>

          <div class="trash-card__actions">
            <button
              type="button"
              class="trash-card__btn trash-card__btn--restore"
              aria-label="恢复"
              title="恢复"
              @click="restore(entry)"
            >
              <AppIcon name="refresh" :size="20" />
            </button>
            <button
              type="button"
              class="trash-card__btn trash-card__btn--purge"
              aria-label="彻底删除"
              title="彻底删除"
              @click="askPurge(entry)"
            >
              <AppIcon name="trash" :width="14" :height="15.75" />
            </button>
          </div>
        </li>
      </ul>

      <!-- 空态 -->
      <div v-else class="trash-empty">
        <span class="trash-empty__icon" aria-hidden="true">
          <AppIcon name="trash" :width="32" :height="36" />
        </span>
        <p class="trash-empty__title">回收站是空的</p>
        <p class="trash-empty__desc">删除的密码会在这里保留 {{ retentionDays }} 天，可随时恢复。</p>
      </div>
    </main>

    <!-- 底部确认面板（彻底删除 / 清空共用） -->
    <ConfirmSheet
      v-model="confirm.visible"
      :title="confirm.title"
      :message="confirm.message"
      :confirm-text="confirm.confirmText"
      tone="danger"
      @confirm="onConfirm"
    />
  </div>
</template>

<style lang="scss" scoped>
.trash-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh; // 固定外壳：header 常驻，主体内部滚动
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

// ---- 顶部导航 ----
.trash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-xs;
  height: calc(#{$layout-header-height} + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) $spacing-sm 0; // 避让刘海 / 状态栏
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

  // 「清空」文字按钮（危险色）
  &__clear {
    @include button-reset;
    flex-shrink: 0;
    padding: $spacing-xs $spacing-sm;
    border-radius: $radius-sm;
    font-size: $font-size-sm; // 14px
    font-weight: $font-weight-medium;
    line-height: $line-height-sm;
    color: $color-danger;
    transition: background-color $transition-base;

    &:hover {
      background-color: rgba($color-danger, 0.08);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-danger, 0.4);
      outline-offset: 2px;
    }
  }

  // 占位：空态时与返回按钮对称，标题保持居中
  &__placeholder {
    flex-shrink: 0;
    width: $size-touch-min;
  }
}

// ---- 保留窗口说明 ----
.trash-note {
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

// ---- 条目列表 ----
.trash-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
  margin: 0;
  padding: 0;
  list-style: none;
}

.trash-card {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  padding: $spacing-2xs $spacing-sm;
  background-color: $color-bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  // 字标方块
  &__tile {
    @include flex-center;
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: $radius-sm;
    background-color: $color-brand-pale;
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    color: $color-brand;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  &__name {
    @include text-ellipsis;
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    color: $color-text-strong;
  }

  &__account {
    @include text-ellipsis;
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-text-muted;
  }

  // 剩余天数徽标
  &__remain {
    margin-top: 2px;
    font-size: $font-size-micro; // 10px
    line-height: $line-height-micro;
    color: $color-text-placeholder;

    // 临期（≤3 天）：危险色提醒
    &--expiring {
      color: $color-danger;
      font-weight: $font-weight-medium;
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
    transition:
      background-color $transition-base,
      color $transition-base;

    &--restore {
      color: $color-link;

      &:hover {
        background-color: rgba($color-link, 0.08);
      }

      &:focus-visible {
        outline: 2px solid rgba($color-link, 0.4);
        outline-offset: 2px;
      }
    }

    &--purge {
      color: $color-danger;

      &:hover {
        background-color: rgba($color-danger, 0.08);
      }

      &:focus-visible {
        outline: 2px solid rgba($color-danger, 0.4);
        outline-offset: 2px;
      }
    }
  }
}

// ---- 空态 ----
.trash-empty {
  @include flex-col-center;
  flex: 1;
  gap: $spacing-xs;
  padding: $spacing-3xl $spacing-lg;
  text-align: center;

  &__icon {
    @include flex-center;
    @include circle(80px);
    margin-bottom: $spacing-xs;
    background-color: $color-bg-input;
    color: $color-text-placeholder;
  }

  &__title {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__desc {
    max-width: 260px;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-muted;
  }
}
</style>
