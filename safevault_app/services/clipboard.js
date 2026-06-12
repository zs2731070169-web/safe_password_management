/**
 * 剪贴板平台抽象层 —— uni-app 版
 *
 * 全端统一走 `uni.setClipboardData`（App / H5 一致），上层（useVault /
 * usePasswordDetail / RecoveryCodeReveal 等）只调用 copyText，不感知运行环境。
 *
 * —— 自源工程（Capacitor @capacitor/clipboard + 浏览器 execCommand 降级）迁移而来 ——
 * 对外 copyText 签名保持一致：成功 resolve、失败 throw，由上层做反馈。
 * uni.setClipboardData 已在底层抹平 App/H5 差异，无需再手写 execCommand 降级。
 *
 * 敏感信息保护（密码 / 恢复码 / 2FA）：复制成功后启动 60s 定时器自动清空剪贴板，
 * 降低被其他应用读取的风险（呼应隐私政策「约 60 秒自动清除」的承诺）。
 * 该清除为「尽力而为」：仅当 60s 内剪贴板仍是本次复制内容时才清（避免误删用户之后复制的别的内容）。
 */

/** 敏感内容自动清除延时（毫秒） */
const CLEAR_DELAY = 60 * 1000

/** 当前挂起的清除定时器（多次复制时，后一次覆盖前一次） */
let clearTimer = null
/** 上次写入剪贴板的内容（清除前比对，避免误删用户后续复制的内容） */
let lastCopied = ''

/**
 * 复制文本到系统剪贴板。失败抛出异常，由上层做反馈。
 *
 * @param {string} text 待复制文本
 * @param {object} [opts]
 * @param {boolean} [opts.sensitive=true] 是否为敏感内容（默认是）：true 时启动 60s 自动清除。
 *   对账号、用户名等非机密内容可传 false，不触发自动清除。
 * @param {boolean} [opts.silent=false] 是否静默（不弹 uni 默认「复制成功」提示）。
 *   上层若需自定义 toast 文案，可传 true 抑制本层提示、由上层自行提示。
 * @returns {Promise<void>}
 */
export function copyText(text, { sensitive = true, silent = false } = {}) {
  if (!text) return Promise.reject(new Error('待复制内容为空'))

  return new Promise((resolve, reject) => {
    uni.setClipboardData({
      data: text,
      // showToast:false —— uni 默认会弹「内容已复制」系统提示；这里交由上层自定义文案，
      // 故默认抑制，避免与上层 toast 叠加双弹。silent=false 时也不开 uni 默认提示，
      // 统一由上层（如 usePasswordDetail 的「已复制密码」）给反馈。
      showToast: false,
      success: () => {
        if (sensitive) scheduleClear(text)
        // silent 仅语义占位：本层不主动 toast，反馈权交上层；保留参数以兼容调用处可读性
        resolve()
      },
      fail: (err) => {
        reject(new Error(err?.errMsg || '复制失败'))
      }
    })
  })
}

/**
 * 安排 60s 后自动清空剪贴板（仅当届时剪贴板仍是本次内容）。
 * @param {string} text 本次复制内容
 */
function scheduleClear(text) {
  // 覆盖上一次未触发的清除定时器
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  lastCopied = text
  clearTimer = setTimeout(() => {
    clearTimer = null
    // 读取当前剪贴板：仍为本次内容才清，避免误删用户之后复制的别的东西
    uni.getClipboardData({
      success: (res) => {
        if (res?.data === lastCopied) {
          uni.setClipboardData({ data: '', showToast: false })
        }
      },
      // 读取失败（部分平台无读权限）：保守起见直接清空本次敏感内容
      fail: () => {
        uni.setClipboardData({ data: '', showToast: false })
      }
    })
  }, CLEAR_DELAY)
}
