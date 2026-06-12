/**
 * 全局轻反馈封装 —— uni-app 版（替代源工程的 Element Plus ElMessage / ElMessageBox）
 *
 * 源工程用 `ElMessage.success/error/info` 弹顶部消息、`ElMessageBox.confirm` 弹确认框。
 * uni-app 无 Element Plus，统一改用 `uni.showToast`（轻提示）与 `uni.showModal`（确认框）。
 *
 * 设计目标：让上层（composables / components）的调用尽量少改——
 *   ElMessage.success('x')  →  toastSuccess('x')
 *   ElMessage.error('x')    →  toastError('x')
 *   ElMessage.info('x')     →  toastInfo('x')
 *   await ElMessageBox.confirm(msg, title, {...}) → await showConfirm({ title, content })
 *
 * 之所以不直接 monkey-patch 一个 ElMessage 对象：uni 的 toast 语义与 EP 略有差异
 * （uni 单实例、success/none 两种 icon），显式命名函数更清晰、避免误用。
 */

/**
 * 成功轻提示（带对勾图标）。
 * @param {string} message 文案（uni toast 限制约 7 个汉字，过长自动用无图标的纯文本）
 * @param {object} [opts]
 * @param {number} [opts.duration=1800] 显示时长 ms
 */
export function toastSuccess(message, { duration = 1800 } = {}) {
  uni.showToast({
    title: String(message ?? ''),
    // 文案较长时 success 图标会挤压文字，改用 none 纯文本
    icon: shouldUseIcon(message) ? 'success' : 'none',
    duration,
    mask: false
  })
}

/**
 * 错误轻提示（uni 无内置 error 图标，统一用 none 纯文本，避免 success 对勾误导）。
 * @param {string} message
 * @param {object} [opts]
 * @param {number} [opts.duration=2200] 显示时长 ms（错误略长，便于看清）
 */
export function toastError(message, { duration = 2200 } = {}) {
  uni.showToast({
    title: String(message ?? ''),
    icon: 'none',
    duration,
    mask: false
  })
}

/**
 * 中性信息轻提示（纯文本）。
 * @param {string} message
 * @param {object} [opts]
 * @param {number} [opts.duration=1800]
 */
export function toastInfo(message, { duration = 1800 } = {}) {
  uni.showToast({
    title: String(message ?? ''),
    icon: 'none',
    duration,
    mask: false
  })
}

/**
 * 确认框（替代 ElMessageBox.confirm）。
 * @param {object} opts
 * @param {string} [opts.title='提示'] 标题
 * @param {string} opts.content 正文
 * @param {string} [opts.confirmText='确定'] 确认按钮文案
 * @param {string} [opts.cancelText='取消'] 取消按钮文案
 * @param {boolean} [opts.danger=false] 是否危险操作（confirm 文字置红，仅部分平台生效）
 * @returns {Promise<boolean>} 点确认 resolve(true)，点取消 / 关闭 resolve(false)
 *   （注意：与 ElMessageBox「取消时 reject」不同，这里统一 resolve 布尔，调用处据返回值判断，
 *    避免 uni 下 try/catch 包裹的繁琐；迁移调用点时已对应调整。）
 */
export function showConfirm({
  title = '提示',
  content = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText,
      cancelText,
      confirmColor: danger ? '#d9483b' : '#2f6bff',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false)
    })
  })
}

/** uni success 图标仅在文案较短（≤7 汉字 / 约14字符）时不挤压，否则退化为纯文本 */
function shouldUseIcon(message) {
  const len = String(message ?? '').length
  return len > 0 && len <= 7
}
