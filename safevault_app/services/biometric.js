/**
 * 生物识别（指纹）平台抽象层 —— uni-app 版
 *
 * 真机（App 端，app-plus）调用 5+ 系统指纹能力 `plus.fingerprint`；
 * H5 / 无插件环境自动降级为 mock 延时，保证浏览器调试可走通整条交互。
 * 上层（useBiometricPrompt）只调用本模块，不感知运行环境。
 *
 * —— 自源工程（Capacitor + @capgo/capacitor-native-biometric）迁移而来 ——
 * 对外四个函数签名、返回结构、错误语义全部保持与源工程一致：
 *   isNativeBiometric / isSystemBiometricAvailable / getBiometricStatus / scanBiometric
 * 使上层零改动。差异仅在底层实现由 Capacitor 插件换为 uni 的 plus.fingerprint。
 *
 * 真实接入说明：本文件即「真实接入点」，App 侧已对接系统指纹；
 * 如需更换为人脸 / 加入凭据存储（配合 secureCredential），只改本文件即可。
 */

// #ifdef APP-PLUS
/** 当前是否为 App 原生环境（plus 可用） */
function hasPlus() {
  return typeof plus !== 'undefined' && plus?.fingerprint
}
// #endif

/** 是否为真机生物识别环境（H5 恒 false → 上层文案显示「模拟」） */
function isNativeEnv() {
  // #ifdef APP-PLUS
  return Boolean(hasPlus())
  // #endif
  // #ifndef APP-PLUS
  return false
  // #endif
}

/** 当前是否为真机生物识别环境（用于界面文案区分：系统指纹 vs 模拟） */
export async function isNativeBiometric() {
  return isNativeEnv()
}

/**
 * 系统是否已录入可用的生物识别（指纹）。
 * 真机：读取系统状态；mock：恒为 true（视为可用）。
 * @returns {Promise<boolean>}
 */
export async function isSystemBiometricAvailable() {
  return (await getBiometricStatus()).available
}

// 生物识别错误码 → 与源工程一致的可读中文提示。
// plus.fingerprint 的 errorCode 体系与 @capgo 不同，这里收敛为同样的人话提示。
const ERROR_MESSAGES = {
  unsupport: '该设备暂不支持指纹或未设置锁屏密码',
  unenrolled: '系统里还没有录入指纹，请到「系统设置 → 指纹」添加后再开启',
  keyguard_insecure: '该设备暂不支持指纹或未设置锁屏密码',
  locked: '指纹多次失败已被锁定，请改用主密码进入',
  unknown: '指纹验证出错，请重试'
}

/**
 * 读取系统生物识别可用状态（含不可用原因）。
 * 真机：调 plus.fingerprint 的同步能力检测；mock（H5）：恒为可用。
 * @returns {Promise<{ available: boolean, errorCode?: string, deviceIsSecure?: boolean }>}
 *   - available：是否可立即发起验证（系统已录入且硬件可用）
 *   - errorCode：不可用原因（仅 available=false 时有意义）
 *   - deviceIsSecure：是否已设锁屏（PIN/图案/密码）
 */
export async function getBiometricStatus() {
  // #ifdef APP-PLUS
  if (hasPlus()) {
    try {
      // 硬件是否支持指纹模块
      if (!plus.fingerprint.isSupport()) {
        return { available: false, errorCode: 'unsupport', deviceIsSecure: false }
      }
      // 是否已设置锁屏（系统安全前提）
      const deviceIsSecure = Boolean(plus.fingerprint.isKeyguardSecure())
      if (!deviceIsSecure) {
        return { available: false, errorCode: 'keyguard_insecure', deviceIsSecure: false }
      }
      // 是否已录入指纹
      if (!plus.fingerprint.isEnrolledFingerprints()) {
        return { available: false, errorCode: 'unenrolled', deviceIsSecure: true }
      }
      return { available: true, deviceIsSecure: true }
    } catch {
      return { available: false, errorCode: 'unknown' }
    }
  }
  // #endif
  // H5 / 无 plus：mock 恒为可用
  return { available: true }
}

/**
 * 触发一次生物识别校验。
 *
 * 真机：拉起系统指纹框（plus.fingerprint.authenticate）。
 *   - 通过 → true
 *   - 用户取消（按取消键 / 点弹窗外 / 系统中断）→ false（静默，由上层停留原处）
 *   - 其它真实错误（未录入 / 硬件不可用 / 被锁定 / 不匹配…）→ throw 带 `code` 与中文 `message` 的 Error，
 *     由上层（useBiometricPrompt）以 uni.showToast 提示，不再无差别吞错。
 * mock：1.2s 延时模拟扫描，可被 signal 取消。
 *
 * @param {object} [opts]
 * @param {string} [opts.reason] 系统弹窗的说明文案
 * @param {AbortSignal} [opts.signal] mock 场景下用于取消（真机由系统弹窗自身控制取消）
 * @returns {Promise<boolean>} 是否通过（true 通过 / false 用户取消）
 * @throws {Error} 真机真实错误（带 `code`、中文 `message`）；或 mock 被 signal 取消时抛 AbortError
 */
export async function scanBiometric({ reason = '请验证您的指纹', signal } = {}) {
  // #ifdef APP-PLUS
  if (hasPlus()) {
    return new Promise((resolve, reject) => {
      plus.fingerprint.authenticate(
        () => resolve(true),
        (e) => {
          const code = e?.code
          // plus.fingerprint 的 FingerprintError 是「正整数」错误码体系（迁移自 Capacitor 时
          // 误沿用了其负数码，导致取消等永远匹配不到、被当成未知错误误报）。
          // 判定优先级：① 用错误对象自带常量比对（e.AUTHENTICATE_CANCEL 等，最稳，跨 ROM 不踩数值差异）；
          //            ② 回退到 HTML5+ 文档数值；③ 同时兼容旧负数码。三重保险。
          //   UNSUPPORT=1 KEYGUARD_INSECURE=2 FINGERPRINT_UNENROLLED=3
          //   AUTHENTICATE_MISMATCH=4 AUTHENTICATE_OVERLIMIT=5 AUTHENTICATE_CANCEL=6

          // ① 用户主动取消（按取消键 / 点弹窗外 / 系统中断）→ 视作未通过，静默，绝不报错
          const CANCEL = e?.AUTHENTICATE_CANCEL ?? 6
          if (code === CANCEL || code === -3) {
            resolve(false)
            return
          }
          // ② 多次失败被锁定
          const OVERLIMIT = e?.AUTHENTICATE_OVERLIMIT ?? 5
          if (code === OVERLIMIT || code === -2) {
            const err = new Error(ERROR_MESSAGES.locked)
            err.code = String(code)
            reject(err)
            return
          }
          // ③ 指纹比对不匹配（最终失败）→ 视作未通过，静默不弹提示（与用户取消同等处理）
          const MISMATCH = e?.AUTHENTICATE_MISMATCH ?? 4
          if (code === MISMATCH || code === -1) {
            resolve(false)
            return
          }
          // ④ 其它真实错误（未录入 / 不支持 / 未设锁屏 / 未知…）
          const err = new Error(ERROR_MESSAGES.unknown)
          err.code = String(code ?? 'unknown')
          reject(err)
        },
        {
          message: reason
        }
      )
    })
  }
  // #endif
  // —— H5 / 无 plus：mock 延时（1.2s 模拟扫描），可被 signal 取消 ——
  return mockScan(signal)
}

/** mock 扫描：1.2s 后通过，可被 AbortSignal 中断（行为与源工程一致） */
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
