<script setup>
/**
 * 密码库内容组件（主导航「库」Tab 内容主体）
 *
 * 由源工程 views/vault/VaultView.vue 平移而来。顶栏 / 底栏 / FAB 由常驻 home 外壳
 * （pages/home/index.vue 的 swiper 外壳）统一提供，本组件只负责「分类 Chips +
 * 「最近更新」列表」主体内容，作为一个 swiper-item 常驻挂载。
 *
 * 关键点：
 *   - 顶栏搜索关键词：仍由 vaultStore 持有（Pinia 跨页持久）；home 顶栏直接读写同一
 *     store 的 keyword，本组件经 useVault 解构出的 keyword 与之共用，互不冲突。
 *   - 导航：FAB 新增由 home 接管；本组件仅处理「打开详情」。
 */
import CategoryChips from './components/CategoryChips.vue'
import PasswordCard from './components/PasswordCard.vue'

import { useVault } from '@/composables/useVault'
import { navTo } from '@/utils/navigation'

const {
  filteredEntries,
  categories,
  activeCategory,
  hydrating,
  lastSyncText,
  setCategory,
  copySecret
} = useVault()

/** 打开密码详情：源 router.push({ name:'PasswordDetail', params:{ id } }) → navTo */
function handleOpen(entry) {
  navTo('PasswordDetail', { id: entry.id })
}
</script>

<template>
  <view class="vault-content">
    <CategoryChips
      :categories="categories"
      :active="activeCategory"
      @change="setCategory"
    />

    <view class="vault-content__section">
      <!-- 标题行：左侧轻量展示云端「上次同步」时间（仅在已登录且拉到备份时出现） -->
      <view class="vault-content__heading-row">
        <text v-if="lastSyncText" class="vault-content__sync">{{ lastSyncText }}</text>
      </view>

      <!-- 登录后从云端下载解密整库期间显示加载占位，拉完再渲染，避免先闪本地 mock -->
      <text v-if="hydrating" class="vault-content__loading">正在从云端同步…</text>

      <view v-else-if="filteredEntries.length" class="vault-content__list">
        <PasswordCard
          v-for="entry in filteredEntries"
          :key="entry.id"
          :entry="entry"
          @copy="copySecret"
          @open="handleOpen"
        />
      </view>

      <text v-else class="vault-content__empty">该分类下暂无密码条目</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.vault-content {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 区块间距 24px
  padding: $spacing-lg $layout-page-padding $spacing-2xl;
  background-color: $color-bg-page;

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
    display: block;
    padding: $spacing-2xl 0;
    text-align: center;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-placeholder;
  }

  // 云端水合加载占位（与 empty 同款排版，文案表「同步中」语义）
  &__loading {
    display: block;
    padding: $spacing-2xl 0;
    text-align: center;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-muted;
  }
}
</style>
