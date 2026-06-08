<script setup>
/**
 * 健康度仪表盘（Health Gauge）
 *
 * 270° 半环进度 + 居中大数字 + 档位文字 + 说明 + 上次检测。
 * 进入页 / 重新检测时，环弧与中心数字 0→当前分 同步增长（0.6s ease-out）。
 * 进度色按分档（strong/good/weak）由 currentColor 统一控制。
 * 还原 Figma node 1:480（Health Gauge Section）+ DRD 3.7。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  /** 健康分（0-100） */
  score: {
    type: Number,
    required: true
  },
  /** 分档：strong / good / weak */
  level: {
    type: String,
    default: 'good'
  },
  /** 分档文字（优秀 / 良好 / 需改善） */
  levelLabel: {
    type: String,
    default: '良好'
  },
  /** 上次检测时间文案 */
  lastScan: {
    type: String,
    default: '刚刚'
  }
})

// —— 270° 半环几何参数 ——
const RADIUS = 84
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const ARC_RATIO = 0.75 // 270° / 360°
const ARC_LEN = CIRCUMFERENCE * ARC_RATIO // 进度弧总长

// 轨道：画满 270°，余下 90° 为底部缺口
const trackDash = `${ARC_LEN} ${CIRCUMFERENCE}`

// —— 进入动画状态 ——
/** 中心展示分数（动画递增） */
const displayScore = ref(0)
/** 进度弧 dashoffset：ARC_LEN 表示全空（0 分），0 表示满 270°（100 分） */
const dashOffset = ref(ARC_LEN)
let rafId = null

/** 说明文案（随分档变化） */
const caption = computed(
  () =>
    ({
      strong: '您的密码安全性非常优秀',
      good: '您的密码安全性总体良好',
      weak: '您的密码安全性有待改善'
    })[props.level] ?? '您的密码安全性总体良好'
)

/** easeOutCubic */
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3)
}

/** 0 → target 增长动画（环弧 + 数字同步） */
function animateTo(target) {
  cancelAnimationFrame(rafId)
  const duration = 600
  let startTs = null

  function step(ts) {
    if (startTs === null) startTs = ts
    const progress = Math.min((ts - startTs) / duration, 1)
    const eased = easeOut(progress)
    const current = target * eased
    displayScore.value = Math.round(current)
    dashOffset.value = ARC_LEN * (1 - current / 100)
    if (progress < 1) {
      rafId = requestAnimationFrame(step)
    }
  }

  rafId = requestAnimationFrame(step)
}

onMounted(() => animateTo(props.score))

// 重新检测后分数变化：重跑增长动画
watch(
  () => props.score,
  (val) => animateTo(val)
)

onBeforeUnmount(() => cancelAnimationFrame(rafId))
</script>

<template>
  <section class="health-gauge" :class="`health-gauge--${level}`">
    <!-- 仪表盘环 -->
    <div class="health-gauge__chart">
      <svg
        class="health-gauge__svg"
        viewBox="0 0 200 175"
        fill="none"
        aria-hidden="true"
      >
        <!-- 背景轨道（270°） -->
        <circle
          class="health-gauge__track"
          cx="100"
          cy="100"
          :r="RADIUS"
          stroke-width="14"
          stroke-linecap="round"
          :stroke-dasharray="trackDash"
          transform="rotate(135 100 100)"
        />
        <!-- 进度弧（按分数，颜色继承 currentColor） -->
        <circle
          class="health-gauge__progress"
          cx="100"
          cy="100"
          :r="RADIUS"
          stroke="currentColor"
          stroke-width="14"
          stroke-linecap="round"
          :stroke-dasharray="trackDash"
          :stroke-dashoffset="dashOffset"
          transform="rotate(135 100 100)"
        />
      </svg>

      <!-- 中心：大数字 + 档位 -->
      <div class="health-gauge__center" role="status" :aria-label="`健康分 ${score} ${levelLabel}`">
        <span class="health-gauge__score">{{ displayScore }}</span>
        <span class="health-gauge__level">{{ levelLabel }}</span>
      </div>
    </div>

    <!-- 说明文案 -->
    <div class="health-gauge__desc">
      <p class="health-gauge__caption">{{ caption }}</p>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.health-gauge {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: $spacing-lg $spacing-xl $spacing-lg; // 24 / 32 / 24
  background: linear-gradient(180deg, $color-bg-page 0%, $color-tile-blue 100%);
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-xl;
  box-shadow: $shadow-shield;
  // 分档色：经 color 透传给进度弧 / 数字 / 档位（currentColor）
  color: $color-score-good;

  &--strong {
    color: $color-score-strong;
  }
  &--good {
    color: $color-score-good;
  }
  &--weak {
    color: $color-score-weak;
  }

  // 环 + 中心叠放
  &__chart {
    position: relative;
    width: 200px;
    height: 175px;
  }

  &__svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  // 背景轨道（浅灰，不参与分档变色）
  &__track {
    stroke: rgba($line-base, 0.45);
    fill: none;
  }

  // 进度弧（继承分档色）
  &__progress {
    fill: none;
    // dashoffset 由脚本驱动；过渡使分数变化时也平滑（首次进入由 rAF 接管）
    transition: stroke-dashoffset $transition-base;
  }

  // 圆心叠放数字 + 档位
  &__center {
    position: absolute;
    left: 50%;
    top: 100px; // 圆心 y（viewBox 100 / 175 → 实际像素 100）
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  &__score {
    font-size: $font-size-display;
    font-weight: $font-weight-bold;
    line-height: $line-height-display;
    font-variant-numeric: tabular-nums; // 数字滚动不抖动
  }

  &__level {
    font-size: $font-size-list-title;
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
  }

  // 说明文案
  &__desc {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: $spacing-xxs;
    margin-top: $spacing-xs;
  }

  &__caption {
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }
}
</style>
