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
import { ref, computed, getCurrentInstance } from 'vue'

import AppIcon from '@/components/icons/AppIcon.vue'
import { copyText } from '@/services/clipboard'
import { saveImageToGallery } from '@/services/imageSaver'
import { toastSuccess, toastError } from '@/utils/feedback'

// 当前组件实例：App 端 uni.createCanvasContext 需在组件作用域内取 canvas，故缓存实例
const instance = getCurrentInstance()

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
    // 恢复码为敏感凭据：sensitive=true（默认）→ 60s 后自动清空剪贴板
    await copyText(props.code)
    toastSuccess('恢复码已复制')
  } catch {
    toastError('复制失败，请手动抄写')
  }
}

/**
 * 保存为图片：把恢复码渲染到画布生成 PNG，再落相册 / 下载。失败给中文提示，不抛。
 *
 * 跨端差异：
 *   - H5：用 document canvas 生成 dataURL，交由 imageSaver 触发下载；
 *   - App：用 uni canvas 绘制后 canvasToTempFilePath 得本地临时文件，直接存进系统相册
 *     （绕开 base64↔文件的多余转换）。
 */
async function handleSaveImage() {
  if (saving.value) return
  saving.value = true
  try {
    // #ifdef H5
    const dataUrl = renderCodeToImageH5(props.code)
    await saveImageToGallery(dataUrl, { fileName: 'SafeVault-恢复码' })
    // #endif
    // #ifdef APP-PLUS
    const tempPath = await renderCodeToTempFileApp(props.code)
    await saveTempFileToAlbum(tempPath)
    // #endif
    toastSuccess('已保存为图片')
  } catch (e) {
    toastError((e && e.message) || '保存图片失败，请改用「复制」或手动抄写')
  } finally {
    saving.value = false
  }
}

/** 勾选「我已安全保存」后点击继续 */
function handleConfirm() {
  if (!acknowledged.value) return
  emit('confirm')
}

/** 把恢复码拆成两行（每行最多 4 组），跨端绘制共用 */
function splitCodeLines(code) {
  const parts = code.includes('-') ? code.split('-') : (code.match(/.{1,4}/g) || [])
  return {
    line1: parts.slice(0, 4).join('-'),
    line2: parts.slice(4).join('-')
  }
}

// #ifdef H5
/**
 * 【H5】把恢复码渲染成一张白底卡片样式的 PNG（dataURL）。
 * 用 document canvas 离屏绘制：标题 + 分组恢复码 + 警示脚注，便于用户存图离线保管。
 * @param {string} code 恢复码明文
 * @returns {string} image/png 的 dataURL
 */
function renderCodeToImageH5(code) {
  // 用 2x 像素密度提升清晰度（导出图在手机相册查看不糊）
  const scale = 2
  const W = 720
  const H = 420
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)

  ctx.fillStyle = '#f9f9ff'
  ctx.fillRect(0, 0, W, H)

  const pad = 32
  ctx.fillStyle = '#ffffff'
  drawRoundedRectH5(ctx, pad, pad, W - pad * 2, H - pad * 2, 16)
  ctx.fill()

  ctx.fillStyle = '#151c27'
  ctx.font = '600 26px Inter, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText('SafeVault 恢复码', pad + 32, pad + 32)

  ctx.fillStyle = '#737686'
  ctx.font = '15px Inter, sans-serif'
  ctx.fillText('忘记密码后恢复数据的唯一凭据 · 请离线妥善保存', pad + 32, pad + 72)

  const { line1, line2 } = splitCodeLines(code)
  ctx.fillStyle = '#151c27'
  ctx.font = "28px 'JetBrains Mono', 'Courier New', monospace"
  ctx.fillText(line1, pad + 32, pad + 130)
  if (line2) ctx.fillText(line2, pad + 32, pad + 178)

  ctx.fillStyle = '#824500'
  ctx.font = '13px Inter, sans-serif'
  ctx.fillText('仅显示一次。丢失此码且忘记密码将无法找回数据。', pad + 32, H - pad - 56)

  return canvas.toDataURL('image/png')
}

/** 【H5】在 canvas 上画圆角矩形路径 */
function drawRoundedRectH5(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
// #endif

// #ifdef APP-PLUS
/**
 * 【App】用 uni canvas 绘制恢复码卡片，导出为本地临时文件路径。
 * 对应模板里的隐藏 <canvas canvas-id="rcCanvas">。uni canvas 不支持 arcTo，
 * 圆角卡片简化为直角白卡（视觉差异可忽略，重点是恢复码清晰可读）。
 * @param {string} code
 * @returns {Promise<string>} 临时文件路径
 */
function renderCodeToTempFileApp(code) {
  return new Promise((resolve, reject) => {
    const W = 720
    const H = 420
    const ctx = uni.createCanvasContext('rcCanvas', instance?.proxy)

    // 背景
    ctx.setFillStyle('#f9f9ff')
    ctx.fillRect(0, 0, W, H)
    // 白卡
    const pad = 32
    ctx.setFillStyle('#ffffff')
    ctx.fillRect(pad, pad, W - pad * 2, H - pad * 2)

    // 标题
    ctx.setFillStyle('#151c27')
    ctx.setFontSize(26)
    ctx.setTextBaseline('top')
    ctx.fillText('SafeVault 恢复码', pad + 32, pad + 32)

    // 副标题
    ctx.setFillStyle('#737686')
    ctx.setFontSize(15)
    ctx.fillText('忘记密码后恢复数据的唯一凭据 · 请离线妥善保存', pad + 32, pad + 72)

    // 恢复码本体
    const { line1, line2 } = splitCodeLines(code)
    ctx.setFillStyle('#151c27')
    ctx.setFontSize(28)
    ctx.fillText(line1, pad + 32, pad + 130)
    if (line2) ctx.fillText(line2, pad + 32, pad + 178)

    // 警示脚注
    ctx.setFillStyle('#824500')
    ctx.setFontSize(13)
    ctx.fillText('仅显示一次。丢失此码且忘记密码将无法找回数据。', pad + 32, H - pad - 56)

    // draw 完成后导出临时文件
    ctx.draw(false, () => {
      // draw 的回调里图像已上屏，稍等一帧确保像素就绪再导出
      setTimeout(() => {
        uni.canvasToTempFilePath(
          {
            canvasId: 'rcCanvas',
            width: W,
            height: H,
            destWidth: W * 2,
            destHeight: H * 2,
            fileType: 'png',
            success: (res) => resolve(res.tempFilePath),
            fail: (err) => reject(new Error(err?.errMsg || '图片导出失败'))
          },
          instance?.proxy
        )
      }, 60)
    })
  })
}

/** 【App】保存本地临时文件到系统相册 */
function saveTempFileToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => {
        const msg = err?.errMsg || ''
        if (msg.includes('auth') || msg.includes('deny')) {
          reject(new Error('未授予相册权限，请到系统设置中开启后重试'))
        } else {
          reject(new Error('保存到相册失败'))
        }
      }
    })
  })
}
// #endif
</script>

<template>
  <view class="rc-reveal">
    <!-- 状态区：钥匙徽章 + 标题 + 说明 -->
    <view class="rc-reveal__status">
      <view class="rc-reveal__badge">
        <AppIcon name="account-key" :width="30" :height="30" :color="'#ffffff'" />
      </view>
      <text class="rc-reveal__title">{{ title }}</text>
      <view class="rc-reveal__subtitle">{{ subtitle }}</view>
    </view>

    <!-- 恢复码展示卡片 -->
    <view class="rc-card">
      <text class="rc-card__label">恢复码</text>
      <view class="rc-code">
        <text v-for="(g, i) in groups" :key="i" class="rc-code__group">{{ g }}</text>
      </view>

      <!-- 复制 / 保存为图片 -->
      <view class="rc-actions">
        <button type="button" class="rc-actions__btn" @click="handleCopy">
          <AppIcon name="copy" :width="16" :height="16" />
          <text>复制</text>
        </button>
        <button
          type="button"
          class="rc-actions__btn"
          :disabled="saving"
          @click="handleSaveImage"
        >
          <AppIcon name="image" :width="16" :height="16" />
          <text>{{ saving ? '保存中…' : '保存为图片' }}</text>
        </button>
      </view>
    </view>

    <!-- 强警示条 -->
    <view class="rc-warn">
      <AppIcon name="warning" :width="16" :height="16" class="rc-warn__icon" />
      <view class="rc-warn__body">
        <!-- uni App 端 view 的直接子文本不渲染，混排文本须整体置于 text 内（text 可嵌 text） -->
        <text class="rc-warn__line">这是忘记密码后恢复数据的<text class="rc-warn__strong">唯一凭据</text>，仅显示这一次。</text>
        <text class="rc-warn__line">一旦丢失此码且忘记密码，将<text class="rc-warn__strong">无法找回</text>已加密的数据。</text>
        <text v-if="showLegacyHint" class="rc-warn__line rc-warn__line--legacy">
          重新生成后，<text class="rc-warn__strong">旧恢复码立即失效</text>，请以本次新码为准。
        </text>
      </view>
    </view>

    <!-- 「我已安全保存」勾选 + 继续。
         uni 无原生 checkbox input，改为整行可点的自绘勾选框：点击切换 acknowledged，
         勾选态由 :class 控制底色、对勾用 v-if 渲染（替代原内联 svg 对勾，跨端可靠）。 -->
    <view class="rc-ack" @click="acknowledged = !acknowledged">
      <view class="rc-ack__box" :class="{ 'rc-ack__box--checked': acknowledged }" aria-hidden="true">
        <AppIcon v-if="acknowledged" name="check" :size="14" :color="'#ffffff'" />
      </view>
      <text class="rc-ack__text">我已安全保存恢复码，明白丢失后无法找回</text>
    </view>

    <button
      type="button"
      class="rc-submit"
      :disabled="!acknowledged"
      @click="handleConfirm"
    >
      <text>{{ confirmText }}</text>
      <AppIcon name="arrow-right" :size="16" class="rc-submit__icon" />
    </button>

    <!-- #ifdef APP-PLUS -->
    <!-- App 端「保存为图片」专用离屏画布：定位移出可视区，仅作绘制载体，不参与布局 -->
    <canvas canvas-id="rcCanvas" class="rc-offscreen-canvas"></canvas>
    <!-- #endif -->
  </view>
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

    // 旧码失效提示：在警示色基础上加重一行
    &--legacy {
      margin-top: $spacing-xxs;
      padding-top: $spacing-xxs;
      border-top: 1px solid rgba($color-warning, 0.25);
    }
  }

  // 行内强调（原 <strong>，uni 化后为带类的 <text>）
  &__strong {
    font-weight: $font-weight-bold;
  }
}

// ---- 「我已安全保存」勾选 ----
.rc-ack {
  display: flex;
  align-items: flex-start;
  gap: $spacing-xs;
  cursor: pointer;
  user-select: none;

  // 自绘勾选框（点击 .rc-ack 整行切换 acknowledged，对勾由 v-if 渲染）
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

    // 勾选态：实心品牌底
    &--checked {
      background-color: $color-brand;
      border-color: $color-brand;
    }
  }

  // 键盘聚焦可见
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

  text {
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

// #ifdef APP-PLUS
// App 端「保存为图片」离屏画布：移出可视区、不占布局，仅作 uni canvas 绘制载体
.rc-offscreen-canvas {
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: 720px;
  height: 420px;
}
// #endif
</style>
