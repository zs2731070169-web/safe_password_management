import { Capacitor } from '@capacitor/core'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'

/**
 * 生物识别（指纹）平台抽象层
 *
 * 真机（Capacitor 原生环境）调用系统指纹弹窗（@capgo/capacitor-native-biometric）；
 * 浏览器 / 无插件环境自动降级为 mock 延时，保证 `npm run dev` 下可正常调试。
 * 上层（useBiometricPrompt）只调用本模块，不感知运行环境。
 *
 * 真实接入说明：本文件即「真实接入点」，原生侧已对接系统指纹；
 * 如需更换插件或加入凭据存储（setCredentials/getCredentials），只改本文件即可。
 */

// 原生插件采用「静态 import + 运行时按平台启用」：
// 之前用动态 import() 想让浏览器不加载插件，但在部分机型（如华为 hwschromium）
// WebView 中，该懒加载 chunk 的 import() 可能既不 resolve 也不 reject（永久挂起），
// 导致首次指纹调用卡死、后续被去重守卫静默拦截。静态 import 把插件打进主包、
// 无需运行时再拉 chunk，彻底规避；浏览器侧仍由 isNativePlatform() 把关不会真正调用。
function loadNativePlugin() {
  return Capacitor?.isNativePlatform?.() ? NativeBiometric : null
}

/** 当前是否为真机生物识别环境（用于界面文案区分：系统指纹 vs 模拟） */
export async function isNativeBiometric() {
  return Boolean(loadNativePlugin())
}

/**
 * 系统是否已录入可用的生物识别（指纹 / 人脸）。
 * 真机：读取系统状态；mock：恒为 true（视为可用）。
 * @returns {Promise<boolean>}
 */
export async function isSystemBiometricAvailable() {
  return (await getBiometricStatus()).available
}

/**
 * 读取系统生物识别可用状态（含不可用原因）。
 * 真机：调插件 `isAvailable`；mock（浏览器/无插件）：恒为可用。
 * @returns {Promise<{ available: boolean, errorCode?: number, deviceIsSecure?: boolean }>}
 *   - available：是否可立即发起验证（系统已录入且硬件可用）
 *   - errorCode：不可用原因（BiometricAuthError，仅 available=false 时有意义）
 *   - deviceIsSecure：是否已设锁屏（PIN/图案/密码）
 */
export async function getBiometricStatus() {
  // 注意：loadNativePlugin() 同步返回 Capacitor 代理对象，绝不能 await 它——
  // await 代理会触发其 .then() 被当成原生方法调用（"NativeBiometric.then() not implemented"）
  // 并导致 await 永远不兑现而卡死。
  const plugin = loadNativePlugin()
  if (!plugin) return { available: true }
  try {
    const r = await plugin.isAvailable({ useFallback: false })
    return {
      available: Boolean(r?.isAvailable),
      errorCode: r?.errorCode,
      deviceIsSecure: r?.deviceIsSecure
    }
  } catch {
    return { available: false }
  }
}

/**
 * 生物识别错误码（@capgo/capacitor-native-biometric 的 BiometricAuthError）。
 * verifyIdentity reject 时 `err.code` 为字符串（如 '3' / '16'）。
 */
// 用户主动取消（按取消键 / 点弹窗外 / 系统中断）——视作「未通过」，不作错误提示
const CANCEL_CODES = new Set(['15', '16'])
// 真实错误码 → 可读且可操作的中文提示
const ERROR_MESSAGES = {
  3: '系统里还没有录入指纹，请到「系统设置 → 指纹」添加后再开启',
  1: '该设备暂不支持指纹或未设置锁屏密码',
  14: '该设备暂不支持指纹或未设置锁屏密码',
  2: '指纹多次失败已被锁定，请改用主密码进入',
  4: '多次未识别，请稍后重试或改用主密码',
  10: '指纹不匹配，请重试'
}

/**
 * 触发一次生物识别校验。
 *
 * 真机：拉起系统指纹框（@capgo verifyIdentity）。
 *   - 通过 → true
 *   - 用户取消（取消类错误码）→ false（静默，由上层停留原处）
 *   - 其它真实错误（未录入 / 硬件不可用 / 被锁定 / 不匹配…）→ throw 带 `code` 与中文 `message` 的 Error，
 *     由上层（useBiometricPrompt）以 ElMessage 提示，不再无差别吞错。
 * mock：1.2s 延时模拟扫描，可被 signal 取消。
 *
 * @param {object} [opts]
 * @param {string} [opts.reason] 系统弹窗的说明文案
 * @param {AbortSignal} [opts.signal] mock 场景下用于取消（真机由系统弹窗自身控制取消）
 * @returns {Promise<boolean>} 是否通过（true 通过 / false 用户取消）
 * @throws {Error} 真机真实错误（带 `code`、中文 `message`）；或 mock 被 signal 取消时抛 AbortError
 */
export async function scanBiometric({ reason = '请验证您的指纹', signal } = {}) {
  // 同步取插件代理，切勿 await（见 getBiometricStatus 处说明）。
  const plugin = loadNativePlugin()
  if (plugin) {
    try {
      // maxAttempts:3 —— 单次误读不立即中止（默认 1 会在第一次失败即以错误码 4 退出）
      await plugin.verifyIdentity({
        reason,
        title: reason,
        subtitle: '',
        description: '',
        maxAttempts: 3
      })
      return true
    } catch (err) {
      const code = String(err?.code ?? '')
      // 用户主动取消：视作未通过，静默返回
      if (CANCEL_CODES.has(code)) return false
      // 真实错误：抛出可读信息，交由上层提示
      const error = new Error(ERROR_MESSAGES[code] ?? '指纹验证出错，请重试')
      error.code = code
      throw error
    }
  }
  // —— 浏览器 / 无插件：mock 延时（1.2s 模拟扫描），可被 signal 取消 ——
  return mockScan(signal)
}

/** mock 扫描：1.2s 后通过，可被 AbortSignal 中断 */
function mockScan(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => resolve(true), 1200)
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
