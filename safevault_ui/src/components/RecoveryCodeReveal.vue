<script setup>
/**
 * RecoveryCodeReveal —— 恢复码展示 / 保存 / 确认（可复用）
 *
 * 用于「忘记密码后恢复数据的唯一凭据」恢复码的一次性展示，由两处复用：
 *   1. 开户流程（注册成功后展示新生成的恢复码）；
 *   2. 设置页「重新生成恢复码」（旧码失效，展示新码）。
 *
 * 职责（纯展示 + 本地操作，不触碰密钥逻辑）：
 *   - 大字等宽分组展示恢复码（JetBrains Mono，按 4 字符一组、连字符分隔，清晰可抄）；
 *   - 强警示文案：唯一凭据 / 仅显示一次 / 请离线妥存 / 丢失且忘密码将无法找回；
 *   - 「复制」（copyText）与「保存为图片」（saveImageToGallery，恢复码渲染进画布）；
 *   - 必须勾选「我已安全保存」后方可点「继续」，确认后 emit('confirm') 交由父级收尾
 *     （父级负责置空 pendingRecoveryCode / 跳转 / 提示旧码失效等）。
 *
 * 交互编排（loading / 反馈）就地完成；不引入额外 store 依赖，保持组件可复用。
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

import AppIcon from '@/components/icons/AppIcon.vue'
import { copyText } from '@/services/clipboard'
import { saveImageToGallery } from '@/services/imageSaver'

const props = defineProps({
  /** 待展示的恢复码明文（形如 ABCD-EFGH-...，由密钥层生成） */
  code: {
    type: String,
    required: true
  },
  /** 主标题（开户与重新生成文案不同，可定制） */
  title: {
    type: String,
    default: '请妥善保存恢复码'
  },
  /** 副标题说明（开户与重新生成场景不同，可定制） */
  subtitle: {
    type: String,
    default: '这是忘记密码后恢复数据的唯一凭据，仅显示这一次。'
  },
  /** 确认按钮文案 */
  confirmText: {
    type: String,
    default: '完成'
  },
  /**
   * 是否提示「旧恢复码已失效」警示条（重新生成场景为 true）。
   * 开户场景无旧码，置 false。
   */
  showLegacyHint: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['confirm'])

/** 「我已安全保存」勾选态——未勾选不允许继续 */
const acknowledged = ref(false)
/** 保存为图片进行中（loading 态，防重复点击） */
const saving = ref(false)

/**
 * 把恢复码拆成分组数组（按连字符），供等宽网格逐组展示。
 * 容错：万一未带连字符则按 4 字符分组兜底。
 */
const groups = computed(() => {
  const raw = props.code || ''
  if (raw.includes('-')) return raw.split('-')
  return raw.match(/.{1,4}/g) || []
})

/** 复制恢复码到剪贴板 */
async function handleCopy() {
  try {
    await copyText(props.code)
    ElMessage.success('恢复码已复制，请粘贴到安全的离线位置')
  } catch {
    ElMessage.error('复制失败，请手动抄写')
  }
}

/**
 * 保存为图片：把恢复码渲染到一张简单画布生成 PNG，再交由 imageSaver 落相册 / 下载。
 * 失败给中文提示，不抛。
 */
async function handleSaveImage() {
  if (saving.value) return
  saving.value = true
  try {
    const dataUrl = renderCodeToImage(props.code)
    await saveImageToGallery(dataUrl, { fileName: 'SafeVault-恢复码' })
    ElMessage.success('恢复码图片已保存')
  } catch {
    ElMessage.error('保存图片失败，请改用「复制」或手动抄写')
  } finally {
    saving.value = false
  }
}

/** 勾选「我已安全保存」后点击继续 */
function handleConfirm() {
  if (!acknowledged.value) return
  emit('confirm')
}

/**
 * 把恢复码渲染成一张白底卡片样式的 PNG（dataURL）。
 * 纯前端 canvas 绘制：标题 + 分组恢复码 + 警示脚注，便于用户存图离线保管。
 * @param {string} code 恢复码明文
 * @returns {string} image/png 的 dataURL
 */
function renderCodeToImage(code) {
  // 用 2x 像素密度提升清晰度（导出图在手机相册查看不糊）
  const scale = 2
  const W = 720
  const H = 420
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)

  // 背景
  ctx.fillStyle = '#f9f9ff'
  ctx.fillRect(0, 0, W, H)

  // 卡片
  const pad = 32
  ctx.fillStyle = '#ffffff'
  drawRoundedRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 16)
  ctx.fill()

  // 标题
  ctx.fillStyle = '#151c27'
  ctx.font = '600 26px Inter, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText('SafeVault 恢复码', pad + 32, pad + 32)

  // 副标题
  ctx.fillStyle = '#737686'
  ctx.font = '15px Inter, sans-serif'
  ctx.fillText('忘记密码后恢复数据的唯一凭据 · 请离线妥善保存', pad + 32, pad + 72)

  // 恢复码本体（等宽，分两行展示，避免横向溢出）
  const parts = code.includes('-') ? code.split('-') : (code.match(/.{1,4}/g) || [])
  const line1 = parts.slice(0, 4).join('-')
  const line2 = parts.slice(4).join('-')
  ctx.fillStyle = '#151c27'
  ctx.font = "28px 'JetBrains Mono', 'Courier New', monospace"
  ctx.fillText(line1, pad + 32, pad + 130)
  if (line2) ctx.fillText(line2, pad + 32, pad + 178)

  // 警示脚注
  ctx.fillStyle = '#824500'
  ctx.font = '13px Inter, sans-serif'
  ctx.fillText('仅显示一次。丢失此码且忘记密码将无法找回数据。', pad + 32, H - pad - 56)

  return canvas.toDataURL('image/png')
}

/** 在 canvas 上画圆角矩形路径（保存图片用） */
function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
</script>

<template>
  <div class="rc-reveal">
    <!-- 状态区：钥匙徽章 + 标题 + 说明 -->
    <div class="rc-reveal__status">
      <div class="rc-reveal__badge">
        <AppIcon name="account-key" :width="30" :height="30" :color="'#ffffff'" />
      </div>
      <h1 class="rc-reveal__title">{{ title }}</h1>
      <p class="rc-reveal__subtitle">{{ subtitle }}</p>
    </div>

    <!-- 恢复码展示卡片 -->
    <section class="rc-card">
      <span class="rc-card__label">恢复码</span>
      <div class="rc-code">
        <span v-for="(g, i) in groups" :key="i" class="rc-code__group">{{ g }}</span>
      </div>

      <!-- 复制 / 保存为图片 -->
      <div class="rc-actions">
        <button type="button" class="rc-actions__btn" @click="handleCopy">
          <AppIcon name="copy" :width="16" :height="16" />
          <span>复制</span>
        </button>
        <button
          type="button"
          class="rc-actions__btn"
          :disabled="saving"
          @click="handleSaveImage"
        >
          <AppIcon name="image" :width="16" :height="16" />
          <span>{{ saving ? '保存中…' : '保存为图片' }}</span>
        </button>
      </div>
    </section>

    <!-- 强警示条 -->
    <div class="rc-warn">
      <AppIcon name="warning" :width="16" :height="16" class="rc-warn__icon" />
      <div class="rc-warn__body">
        <p class="rc-warn__line">这是忘记密码后恢复数据的<strong>唯一凭据</strong>，仅显示这一次。</p>
        <p class="rc-warn__line">一旦丢失此码且忘记密码，将<strong>无法找回</strong>已加密的数据。</p>
        <p v-if="showLegacyHint" class="rc-warn__line rc-warn__line--legacy">
          重新生成后，<strong>旧恢复码立即失效</strong>，请以本次新码为准。
        </p>
      </div>
    </div>

    <!-- 「我已安全保存」勾选 + 继续 -->
    <label class="rc-ack">
      <input
        type="checkbox"
        class="rc-ack__input"
        v-model="acknowledged"
      />
      <span class="rc-ack__box" aria-hidden="true">
        <svg class="rc-ack__check" viewBox="0 0 16 16" width="14" height="14">
          <path
            d="M3.5 8.5l3 3 6-6.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="rc-ack__text">我已安全保存恢复码，明白丢失后无法找回</span>
    </label>

    <button
      type="button"
      class="rc-submit"
      :disabled="!acknowledged"
      @click="handleConfirm"
    >
      <span>{{ confirmText }}</span>
      <AppIcon name="arrow-right" :size="16" class="rc-submit__icon" />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.rc-reveal {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 各区块间距 24px
  width: 100%;
}

// ---- 状态区 ----
.rc-reveal__status {
  @include flex-col-center;
}

.rc-reveal__badge {
  @include flex-center;
  @include circle(64px);
  margin-bottom: $spacing-sm; // 16px
  background-color: $color-brand-bright;
  box-shadow: $shadow-biometric;
}

.rc-reveal__title {
  margin-top: $spacing-xs; // 8px
  font-size: $font-size-heading; // 20px
  font-weight: $font-weight-medium;
  line-height: $line-height-heading;
  color: $color-text-strong;
  text-align: center;
}

.rc-reveal__subtitle {
  margin-top: $spacing-xxs; // 4px
  max-width: 320px;
  font-size: $font-size-sm; // 14px
  line-height: $line-height-sm;
  color: $color-text-regular;
  text-align: center;
}

// ---- 恢复码卡片 ----
.rc-card {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm; // 16px
  padding: $spacing-sm;
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  &__label {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-label;
    text-transform: uppercase;
    color: $color-text-muted;
  }
}

// 恢复码本体：等宽分组、可换行、字号大便于抄写
.rc-code {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-xs; // 组间 8px
  padding: $spacing-2xs $spacing-2xs;
  background-color: $color-bg-input;
  border-radius: $radius-sm;

  &__group {
    font-family: $font-family-mono;
    font-size: $font-size-heading; // 20px 大字
    line-height: $line-height-heading;
    letter-spacing: $letter-spacing-code;
    color: $color-text-strong;
    user-select: all; // 便于长按全选拷贝
  }
}

// 复制 / 保存为图片
.rc-actions {
  display: flex;
  gap: $spacing-xs;

  &__btn {
    @include button-reset;
    @include flex-center;
    gap: $spacing-xxs; // 4px
    flex: 1;
    height: 44px;
    border-radius: $radius-sm;
    background-color: rgba($color-link, 0.1);
    font-size: $font-size-sm; // 14px
    font-weight: $font-weight-medium;
    line-height: $line-height-sm;
    color: $color-link;
    transition:
      background-color $transition-base,
      opacity $transition-base;

    &:hover:not(:disabled) {
      background-color: rgba($color-link, 0.16);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 1px;
    }
  }
}

// ---- 强警示条 ----
.rc-warn {
  display: flex;
  align-items: flex-start;
  gap: $spacing-xs;
  padding: $spacing-2xs $spacing-sm;
  background-color: $color-warning-soft;
  border-radius: $radius-sm;

  &__icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: $color-warning;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: $spacing-xxs; // 4px
  }

  &__line {
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-warning;

    strong {
      font-weight: $font-weight-bold;
    }

    // 旧码失效提示：在警示色基础上加重一行
    &--legacy {
      margin-top: $spacing-xxs;
      padding-top: $spacing-xxs;
      border-top: 1px solid rgba($color-warning, 0.25);
    }
  }
}

// ---- 「我已安全保存」勾选 ----
.rc-ack {
  display: flex;
  align-items: flex-start;
  gap: $spacing-xs;
  cursor: pointer;
  user-select: none;

  // 隐藏原生 checkbox，仅留作受控源（保留可聚焦以便键盘可达）
  &__input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  // 自绘勾选框
  &__box {
    @include flex-center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    border: 1.5px solid $color-border;
    border-radius: $radius-sm;
    background-color: $color-bg-card;
    color: $color-white;
    transition:
      background-color $transition-base,
      border-color $transition-base;
  }

  &__check {
    opacity: 0;
    transition: opacity $transition-fast;
  }

  // 勾选态：实心品牌底 + 显示对勾
  &__input:checked + &__box {
    background-color: $color-brand;
    border-color: $color-brand;
  }

  &__input:checked + &__box .rc-ack__check {
    opacity: 1;
  }

  // 键盘聚焦可见
  &__input:focus-visible + &__box {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &__text {
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
  }
}

// ---- 继续按钮 ----
.rc-submit {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs;
  width: 100%;
  height: 56px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  span {
    font-size: $font-size-list-title; // 15px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
  }

  &__icon {
    color: $color-white;
  }

  &:hover:not(:disabled) {
    filter: brightness(0.94);
  }

  &:active:not(:disabled) {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}
</style>
