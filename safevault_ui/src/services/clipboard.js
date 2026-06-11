import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'

/**
 * 剪贴板平台抽象层
 *
 * 真机（Capacitor 原生环境）走系统剪贴板（@capacitor/clipboard）；
 * 浏览器优先 Clipboard API，再降级 execCommand 兼容非安全上下文。
 * 上层（useVault / usePasswordDetail / useRecoveryCode 等）只调用 copyText，不感知运行环境。
 *
 * 为何走原生插件：Android WebView 中 navigator.clipboard 常因非安全上下文 / 权限
 * 不可用，opacity:0 的 textarea + execCommand 也常失败，导致「复制」在手机上无效。
 * 与 services/biometric 一致采用静态 import + 运行时按平台启用（避免动态 import 在
 * 个别 WebView 永久挂起）。
 */

/**
 * 复制文本到系统剪贴板。失败抛出异常，由上层做反馈。
 * @param {string} text 待复制文本
 * @returns {Promise<void>}
 */
export async function copyText(text) {
  if (!text) throw new Error('待复制内容为空')

  // —— 真机：系统剪贴板（WebView 下的 web API 不可靠）——
  if (Capacitor?.isNativePlatform?.()) {
    await Clipboard.write({ string: text })
    return
  }

  // —— 浏览器：优先安全上下文 Clipboard API ——
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  // —— 降级：非安全上下文用 execCommand ——
  await execCommandCopy(text)
}

/** execCommand 复制降级：临时 textarea 选中后 copy */
function execCommandCopy(text) {
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      ok ? resolve() : reject(new Error('execCommand 复制失败'))
    } catch (err) {
      reject(err)
    }
  })
}
