<script setup>
/**
 * 密码健康度内容组件（主导航「健康」Tab 内容主体）
 *
 * 由源工程 views/health/HealthView.vue 平移而来。顶栏 / 底栏由常驻 home 外壳
 * （pages/home/index.vue 的 swiper 外壳）统一提供，本组件只负责「HealthGauge 仪表盘 +
 * 问题清单 + InsightCard 安全建议」主体内容，作为一个 swiper-item 常驻挂载。
 *
 * 关键点：
 *   - 顶栏搜索关键词：由 healthStore 持有；home 顶栏直接读写同一 store 的 keyword，
 *     本组件经 useHealth 解构出的 keyword 与之共用（问题清单照常过滤）。
 */
import { onBeforeUnmount } from 'vue'

import HealthGauge from './components/HealthGauge.vue'
import ProblemCard from './components/ProblemCard.vue'
import InsightCard from './components/InsightCard.vue'

import { useHealth } from '@/composables/useHealth'

const {
  score,
  lastScan,
  keyword, // 仅用于「安全建议是否展示 / 空态文案」的派生判断（与 home 顶栏共用同一 store）
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
  <view class="health-content">
    <!-- 仪表盘 -->
    <HealthGauge
      :score="score"
      :level="scoreLevel"
      :level-label="scoreLevelLabel"
      :last-scan="lastScan"
    />

    <!-- 问题清单 -->
    <view class="health-content__problems">
      <view class="health-content__problems-head">
        <!-- 混排「问题清单 (N)」整体包进 text，计数用嵌套 text 着色 -->
        <text class="health-content__heading">
          问题清单<text class="health-content__count"> ({{ problemCount }})</text>
        </text>
        <button
          type="button"
          class="health-content__rescan"
          :disabled="rescanning"
          @click="rescan"
        >
          {{ rescanning ? '检测中…' : '重新扫描' }}
        </button>
      </view>

      <view class="health-content__list">
        <ProblemCard
          v-for="item in filteredIssues"
          :key="item.id"
          :entry="item"
          @fix="fixProblem"
        />

        <!-- 安全建议：仅在非搜索态展示（它不属于问题项） -->
        <InsightCard v-if="insight && !keyword" :insight="insight" />

        <!-- 空态：搜索无匹配 / 全部健康 -->
        <text v-if="!filteredIssues.length" class="health-content__empty">
          {{ keyword ? '未找到相关问题项' : '太棒了，全部密码都很安全！' }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.health-content {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm; // 区块间距 16px
  padding: $spacing-sm $layout-page-padding $spacing-2xl;
  background-color: $color-bg-page;

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

    &:disabled {
      opacity: 0.5;
    }
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
}
</style>
