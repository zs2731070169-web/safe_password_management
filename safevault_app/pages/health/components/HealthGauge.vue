<script setup>
/**
 * 健康度仪表盘（Health Gauge，密码健康度页私有子组件，uni-app 版）
 *
 * 270° 半环进度 + 居中大数字 + 档位文字 + 说明。
 * 进入页 / 重新检测时，环弧与中心数字 0→当前分 同步增长（约 0.6s ease-out）。
 * 进度色按分档（strong/good/weak）由 currentColor 统一控制。
 * 还原 Figma node 1:480（Health Gauge Section）+ DRD 3.7。
 *
 * uni 化要点：
 *   - 动画驱动：源工程用 requestAnimationFrame，App 端无 rAF（仅 H5 有），改用
 *     setInterval 定帧（约 16ms/帧）逐帧推进，两端一致；卸载清定时器。
 *   - SVG：不能用内联 <svg>/<circle>——uni 的 app-vue 编译器把它们当未知标签，
 *     会丢失 :r / :stroke-dasharray / :stroke-dashoffset 等绑定，真机整环不渲染
 *     （H5 因浏览器原生支持 svg 正常，故易被误判可用）。改走 AppIcon 同款路线：
 *     把两段圆环（轨道 + 进度弧）整体拼成 data:image/svg+xml，作 <view> 背景图，
 *     由图片解码器解析（绕开模板编译器）。dashoffset / 分档色随动画重算 URI。
 *   - 颜色：currentColor 在背景图里无意义，分档色改在 JS 内按 level 映射为字面量。
 *   - 标签：section/div→view，span/p→text。
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

// 轨道：画满 270°，余下 90° 为底部缺口（轨道与进度弧共用此 dash）
const ARC_DASH = `${ARC_LEN} ${CIRCUMFERENCE}`

// 分档色字面量（与 styles/variables.scss 的 $color-score-* 同步；背景图内 currentColor 无效，故落到 JS）
const LEVEL_COLORS = { strong: '#16a34a', good: '#d97706', weak: '#ba1a1a' }
// 背景轨道色：rgba($line-base #bdc2d1, 0.45)，不参与分档变色
const TRACK_COLOR = 'rgba(189,194,209,0.45)'

// —— 进入动画状态 ——
/** 中心展示分数（动画递增） */
const displayScore = ref(0)
/** 进度弧 dashoffset：ARC_LEN 表示全空（0 分），0 表示满 270°（100 分） */
const dashOffset = ref(ARC_LEN)
let timer = null
let startTs = 0
let animTarget = 0

/**
 * 仪表盘背景图（data:image/svg+xml）：轨道 + 进度弧两段圆环整体拼出。
 * 随 dashOffset（动画推进）与 level（分档色）重算；encodeURIComponent 处理 # / 空格 / rgba 括号等。
 */
const gaugeUri = computed(() => {
  const color = LEVEL_COLORS[props.level] ?? LEVEL_COLORS.good
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 175" fill="none">` +
    `<circle cx="100" cy="100" r="${RADIUS}" stroke="${TRACK_COLOR}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${ARC_DASH}" transform="rotate(135 100 100)"/>` +
    `<circle cx="100" cy="100" r="${RADIUS}" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${ARC_DASH}" stroke-dashoffset="${dashOffset.value}" transform="rotate(135 100 100)"/>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})

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

/**
 * 0 → target 增长动画（环弧 + 数字同步）。
 * 用 setInterval 定帧驱动（两端通用，替代仅 H5 可用的 requestAnimationFrame）。
 */
function animateTo(target) {
  clearTimer()
  const duration = 600
  animTarget = target
  startTs = Date.now()

  timer = setInterval(() => {
    const progress = Math.min((Date.now() - startTs) / duration, 1)
    const eased = easeOut(progress)
    const current = animTarget * eased
    displayScore.value = Math.round(current)
    dashOffset.value = ARC_LEN * (1 - current / 100)
    if (progress >= 1) clearTimer()
  }, 16)
}

/** 清除动画定时器 */
function clearTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => animateTo(props.score))

// 重新检测后分数变化：重跑增长动画
watch(
  () => props.score,
  (val) => animateTo(val)
)

onBeforeUnmount(clearTimer)
</script>

<template>
  <view class="health-gauge" :class="`health-gauge--${level}`">
    <!-- 仪表盘环（轨道 + 进度弧整体作 data:svg 背景图，绕开 app-vue 对 <svg> 的标签丢弃） -->
    <view class="health-gauge__chart">
      <view
        class="health-gauge__svg"
        :style="{ backgroundImage: `url('${gaugeUri}')` }"
      />

      <!-- 中心：大数字 + 档位 -->
      <view class="health-gauge__center">
        <text class="health-gauge__score">{{ displayScore }}</text>
        <text class="health-gauge__level">{{ levelLabel }}</text>
      </view>
    </view>

    <!-- 说明文案 -->
    <view class="health-gauge__desc">
      <text class="health-gauge__caption">{{ caption }}</text>
    </view>
  </view>
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
  box-sizing: border-box;
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

  // 仪表盘背景图：data:svg（轨道 + 进度弧），viewBox 200×175 与本容器同比，铺满即可
  &__svg {
    display: block;
    width: 100%;
    height: 100%;
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
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
