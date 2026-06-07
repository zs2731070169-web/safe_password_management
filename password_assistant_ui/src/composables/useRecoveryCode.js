/**
 * useRecoveryCode —— 恢复码管理（重新生成 / 保存）交互编排
 *
 * 职责：
 *   - generate：身份验证通过后生成一组新的 25 位恢复码（mock，旧码即失效）；
 *   - copyCode：复制恢复码到剪贴板并反馈（沿用 useVault 的剪贴板降级方案）；
 *   - saveAsImage：将恢复码渲染为 PNG 卡片并触发下载（纯前端 canvas，无第三方依赖）。
 *
 * 视图只调用本组合式函数，不直接触碰剪贴板 / canvas / 生成逻辑。
 * 真实接入时仅替换文件末尾的 mock 生成与延时实现，视图与样式不动。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { copyText } from '@/services/clipboard'
import { saveImageToGallery } from '@/services/imageSaver'
import { useRecoveryStore } from '@/stores/recovery'

/** 恢复码分组规格：5 组 × 每组 5 位 */
const GROUP_COUNT = 5
const GROUP_SIZE = 5
/** 取字符集（剔除易混淆的 0/O/1/I/L） */
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function useRecoveryCode() {
  const recoveryStore = useRecoveryStore()

  /** 当前恢复码（格式 XXXXX-XXXXX-XXXXX-XXXXX-XXXXX） */
  const code = ref('')
  /** 生成中标志 */
  const generating = ref(false)
  /** 请求取消控制器 */
  let abortController = null

  /**
   * 生成一组新的恢复码（mock：模拟服务端生成延时）
   * @returns {Promise<string>} 新恢复码，被取消时返回空串
   */
  async function generate() {
    if (abortController) abortController.abort()
    abortController = new AbortController()

    generating.value = true
    try {
      // TODO: 替换为真实「重新生成恢复码」接口
      await mockDelay(700, abortController.signal)
      code.value = mockGenerateCode()
      // 新码即时生效、旧码失效：写入共享 store，供找回流程（useRecovery）验证
      recoveryStore.setRecoveryCode(code.value)
      return code.value
    } catch (err) {
      if (err?.name === 'AbortError') return ''
      ElMessage.error('恢复码生成失败，请重试')
      return ''
    } finally {
      generating.value = false
    }
  }

  /** 复制恢复码到剪贴板并反馈 */
  async function copyCode() {
    if (!code.value) return
    try {
      await copyText(code.value)
      ElMessage({
        type: 'success',
        duration: 2500,
        grouping: true,
        message: '恢复码已复制，请尽快粘贴至安全处'
      })
    } catch {
      ElMessage.error('复制失败，请手动抄写')
    }
  }

  /** 图片保存中标志（防重复点击） */
  const saving = ref(false)

  /**
   * 将恢复码渲染为 PNG 卡片并保存。
   * 真机：写入系统相册（@capacitor-community/media）；浏览器：降级为下载。
   * 平台差异收敛在 services/imageSaver，本处只管渲染与反馈。
   */
  async function saveAsImage() {
    if (!code.value || saving.value) return
    saving.value = true
    try {
      const dataUrl = renderCodeToPng(code.value)
      await saveImageToGallery(dataUrl, { fileName: 'SafeVault-恢复码' })
      ElMessage.success('恢复码图片已保存到相册')
    } catch {
      ElMessage.error('图片保存失败，请改用「复制」')
    } finally {
      saving.value = false
    }
  }

  /** 清理：取消进行中的生成请求 */
  function cleanup() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    code,
    generating,
    saving,
    generate,
    copyCode,
    saveAsImage,
    cleanup
  }
}

// ===============================================================
// 以下为 mock / 平台能力实现，真实接入时替换 mock 部分即可
// ===============================================================

/** 生成一组随机恢复码（mock） */
function mockGenerateCode() {
  const groups = []
  for (let g = 0; g < GROUP_COUNT; g++) {
    let group = ''
    for (let i = 0; i < GROUP_SIZE; i++) {
      group += CHARSET[Math.floor(Math.random() * CHARSET.length)]
    }
    groups.push(group)
  }
  return groups.join('-')
}

/** 可被 AbortSignal 中断的延时 Promise */
function mockDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}


/**
 * 将恢复码绘制为 PNG 卡片，返回 dataURL。
 * 采用 devicePixelRatio 放大画布以保证移动端导出清晰。
 * @param {string} value 恢复码
 * @returns {string} image/png 的 dataURL
 */
function renderCodeToPng(value) {
  // 逻辑尺寸（CSS px），再按 dpr 放大物理像素
  const W = 720
  const H = 420
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3))

  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  ctx.scale(dpr, dpr)

  // 页面底色
  ctx.fillStyle = '#f9f9ff'
  ctx.fillRect(0, 0, W, H)

  // 白色圆角卡片
  const cardX = 40
  const cardY = 40
  const cardW = W - 80
  const cardH = H - 80
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#c3c6d7'
  ctx.stroke()

  const centerX = W / 2
  ctx.textAlign = 'center'

  // 标题
  ctx.fillStyle = '#151c27'
  ctx.font = '600 26px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('SafeVault 账户恢复码', centerX, cardY + 64)

  // 副标题
  ctx.fillStyle = '#737686'
  ctx.font = '15px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('忘记主密码时恢复加密资料的唯一凭据，请妥善保存', centerX, cardY + 96)

  // 恢复码（等宽，自动换行为两行以适配宽度）
  ctx.fillStyle = '#434655'
  ctx.font = '600 30px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace'
  const groups = value.split('-')
  const line1 = groups.slice(0, 3).join('  -  ')
  const line2 = groups.slice(3).join('  -  ')
  ctx.fillText(line1, centerX, cardY + 178)
  ctx.fillText(line2, centerX, cardY + 222)

  // 分隔线
  ctx.strokeStyle = '#e2e8f8'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cardX + 48, cardY + cardH - 92)
  ctx.lineTo(cardX + cardW - 48, cardY + cardH - 92)
  ctx.stroke()

  // 底部安全说明
  ctx.fillStyle = '#737686'
  ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('END-TO-END ENCRYPTED · AES-256 / Argon2id', centerX, cardY + cardH - 56)
  ctx.fillText('恢复码仅在本地设备生成，SafeVault 绝不接触您的私钥', centerX, cardY + cardH - 32)

  return canvas.toDataURL('image/png')
}

/** 在 2D 上下文中描出圆角矩形路径 */
function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
