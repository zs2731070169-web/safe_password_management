<script setup>
/**
 * VaultView —— 密码库主页内容（主导航「库」Tab）
 *
 * 仅承载中间可滚动内容；固定顶栏、底栏、悬浮新增按钮由常驻外壳 MainTabLayout 提供。
 * 像素级还原 Figma「密码库主页」(node 1:962) 的内容区。
 * 结构（自上而下）：横向分类 Chips +「最近更新」列表。
 * 搜索关键词由外壳顶栏写入同一 vault store，列表照常响应过滤。
 */
import { useRouter } from 'vue-router'

import CategoryChips from './components/CategoryChips.vue'
import PasswordCard from './components/PasswordCard.vue'

import { useVault } from '@/composables/useVault'

const {
  filteredEntries,
  categories,
  activeCategory,
  hydrating,
  lastSyncText,
  setCategory,
  copySecret
} = useVault()

const router = useRouter()

/** 打开密码详情 */
function handleOpen(entry) {
  router.push({ name: 'PasswordDetail', params: { id: entry.id } })
}
</script>

<template>
  <main class="vault-content">
    <CategoryChips
      :categories="categories"
      :active="activeCategory"
      @change="setCategory"
    />

    <section class="vault-content__section">
      <!-- 标题行：左侧轻量展示云端「上次同步」时间（仅在已登录且拉到备份时出现） -->
      <div class="vault-content__heading-row">
        <h2 v-if="lastSyncText" class="vault-content__sync">{{ lastSyncText }}</h2>
      </div>

      <!-- 登录后从云端下载解密整库期间显示加载占位，拉完再渲染，避免先闪本地 mock -->
      <p v-if="hydrating" class="vault-content__loading">正在从云端同步…</p>

      <div v-else-if="filteredEntries.length" class="vault-content__list">
        <PasswordCard
          v-for="entry in filteredEntries"
          :key="entry.id"
          :entry="entry"
          @copy="copySecret"
          @open="handleOpen"
        />
      </div>

      <p v-else class="vault-content__empty">该分类下暂无密码条目</p>
    </section>
  </main>
</template>

<style lang="scss" scoped>
.vault-content {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 区块间距 24px
  height: 100%;
  padding: $spacing-lg $layout-page-padding $spacing-2xl;
  background-color: $color-bg-page;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  &__section {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm; // 标题与列表 16px
    padding-top: $spacing-xs;
  }

  // 标题行：标题左对齐、同步时间右对齐，两端基线对齐
  &__heading-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: $spacing-sm;
  }

  &__heading {
    font-size: $font-size-caption;
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-muted;
  }

  // 「上次同步」副信息：比标题更弱一级的占位灰，caption 字号，作为轻量提示不抢列表焦点
  &__sync {
    flex-shrink: 0;
    font-size: $font-size-caption;
    line-height: $line-height-caption;
    color: $color-text-placeholder;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm; // 卡片间距 16px
  }

  &__empty {
    padding: $spacing-2xl 0;
    text-align: center;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-placeholder;
  }

  // 云端水合加载占位（与 empty 同款排版，文案表「同步中」语义）
  &__loading {
    padding: $spacing-2xl 0;
    text-align: center;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-muted;
  }
}
</style>
