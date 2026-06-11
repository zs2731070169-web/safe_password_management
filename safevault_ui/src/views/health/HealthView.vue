<script setup>
/**
 * HealthView —— 密码健康度中心页内容（主导航「健康」Tab）
 *
 * 仅承载中间可滚动内容；固定顶栏、底栏由常驻外壳 MainTabLayout 提供。
 * 像素级还原 Figma「密码健康度中心-优化版」(node 1:447) + DRD 4.9 的内容区。
 * 结构（自上而下）：HealthGauge 仪表盘 + 问题清单 header + ProblemCard 列表 + InsightCard 安全建议。
 * 搜索关键词由外壳顶栏写入同一 health store，问题清单照常响应过滤。
 */
import { onBeforeUnmount } from 'vue'

import HealthGauge from './components/HealthGauge.vue'
import ProblemCard from './components/ProblemCard.vue'
import InsightCard from './components/InsightCard.vue'

import { useHealth } from '@/composables/useHealth'

const {
  score,
  lastScan,
  keyword,
  problemCount,
  filteredIssues,
  insight,
  scoreLevel,
  scoreLevelLabel,
  rescanning,
  rescan,
  fixProblem,
  cleanup
} = useHealth()

onBeforeUnmount(cleanup)
</script>

<template>
  <main class="health-content">
    <!-- 仪表盘 -->
    <HealthGauge
      :score="score"
      :level="scoreLevel"
      :level-label="scoreLevelLabel"
      :last-scan="lastScan"
    />

    <!-- 问题清单 -->
    <section class="health-content__problems">
      <header class="health-content__problems-head">
        <h2 class="health-content__heading">
          问题清单
          <span class="health-content__count">({{ problemCount }})</span>
        </h2>
        <button
          type="button"
          class="health-content__rescan"
          :disabled="rescanning"
          @click="rescan"
        >
          {{ rescanning ? '检测中…' : '重新扫描' }}
        </button>
      </header>

      <div class="health-content__list">
        <ProblemCard
          v-for="item in filteredIssues"
          :key="item.id"
          :entry="item"
          @fix="fixProblem"
        />

        <!-- 安全建议：仅在非搜索态展示（它不属于问题项） -->
        <InsightCard v-if="insight && !keyword" :insight="insight" />

        <!-- 空态：搜索无匹配 / 全部健康 -->
        <p v-if="!filteredIssues.length" class="health-content__empty">
          {{ keyword ? '未找到相关问题项' : '太棒了，全部密码都很安全！' }}
        </p>
      </div>
    </section>
  </main>
</template>

<style lang="scss" scoped>
.health-content {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm; // 区块间距 16px
  height: 100%;
  padding: $spacing-sm $layout-page-padding $spacing-2xl;
  background-color: $color-bg-page;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  &__problems {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;
  }

  &__problems-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: $spacing-sm;
  }

  &__heading {
    display: inline-flex;
    align-items: center;
    gap: $spacing-xs;
    font-size: $font-size-list-title;
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__count {
    font-weight: $font-weight-bold;
    color: $color-danger;
  }

  // 重新扫描链接
  &__rescan {
    @include button-reset;
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-link;
    transition: opacity $transition-base;

    &:hover {
      opacity: 0.75;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
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
}
</style>
