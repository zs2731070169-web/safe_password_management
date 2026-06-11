import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { isNativeBiometric, scanBiometric } from '@/services/biometric'

/**
 * useBiometricPrompt —— 全局指纹流程编排（单例）
 *
 * 解锁页与设置页共用本单例发起「录入(enroll) / 验证(verify)」指纹流程。
 *
 * 两条路径：
 *   - 真机：直接拉起系统指纹框（不再走 App 自绘弹窗），手指一按即识别；
 *     失败的真实错误（未录入 / 被锁定…）由本处 ElMessage 提示，用户取消则静默。
 *   - 浏览器/无插件：打开 App.vue 挂载的 <BiometricPrompt> 自绘弹窗，轻触走 mock 扫描动画。
 *
 * 用法（任意视图 / 组合式）：
 *   const { requestBiometric } = useBiometricPrompt()
 *   const ok = await requestBiometric('verify')  // true=通过, false=取消/失败
 *
 * 状态为模块级共享（单例），保证全局只有一个弹窗实例与一次进行中的请求。
 */

// —— 模块级共享状态（单例）——
/** 弹窗显隐 */
const visible = ref(false)
/** 当前模式：'enroll' 录入 | 'verify' 验证 */
const mode = ref('verify')
/** 扫描中（等待系统指纹 / mock 延时） */
const scanning = ref(false)
/** 错误提示（识别失败时同界面展示，可重试） */
const errorMsg = ref('')
/** 是否真机生物识别环境（决定文案） */
const native = ref(false)

/** 当前请求的 promise resolver（仅浏览器自绘弹窗路径使用） */
let resolver = null
/** mock 扫描取消控制器 */
let controller = null
/** 是否有进行中的请求（防重复触发，真机/浏览器通用） */
let pending = false

// 初始化一次：探测运行环境，仅影响界面文案
isNativeBiometric().then((v) => {
  native.value = v
})

/**
 * 发起一次指纹流程。
 * 真机：直接拉起系统指纹框并返回结果；浏览器：打开自绘弹窗等待轻触。
 * @param {'enroll'|'verify'} type 模式
 * @returns {Promise<boolean>} 通过 true / 取消或失败 false
 */
async function requestBiometric(type = 'verify') {
  // 防重复：已有进行中的请求直接忽略本次（真机单次触摸会被 WebView 合成额外 click，
  // 这里可挡掉重复触发）
  if (pending) return false
  pending = true
  mode.value = type === 'enroll' ? 'enroll' : 'verify'

  try {
    // —— 真机：跳过自绘弹窗，直接拉起系统指纹框 ——
    if (await isNativeBiometric()) {
      // 文案避开「录入」字样（系统无法录入，仅验证已有指纹）
      const reason = mode.value === 'enroll' ? '验证指纹以开启快速解锁' : '验证指纹以继续'
      try {
        return await scanBiometric({ reason })
      } catch (err) {
        // 真实错误（未录入 / 硬件不可用 / 被锁定 / 不匹配…）：提示后按未通过处理
        ElMessage.error(err?.message || '指纹验证出错，请重试')
        return false
      }
    }

    // —— 浏览器 / 无插件：打开自绘弹窗，等待用户轻触（startScan）——
    errorMsg.value = ''
    scanning.value = false
    visible.value = true
    return await new Promise((resolve) => {
      resolver = resolve
    })
  } finally {
    pending = false
  }
}

/** 用户轻触指纹区，开始扫描（真机弹系统指纹，浏览器走 mock） */
async function startScan() {
  if (scanning.value) return
  errorMsg.value = ''
  scanning.value = true
  controller = new AbortController()
  const reason = mode.value === 'enroll' ? '录入指纹以开启快速解锁' : '验证指纹以继续'
  try {
    const ok = await scanBiometric({ reason, signal: controller.signal })
    if (ok) {
      finish(true)
    } else {
      errorMsg.value = '未能识别，请重试'
      scanning.value = false
    }
  } catch (err) {
    // 取消（AbortError）不算错误；其余异常提示重试
    if (err?.name !== 'AbortError') errorMsg.value = '验证出错，请重试'
    scanning.value = false
  }
}

/** 取消（用户主动关闭弹窗） */
function cancel() {
  controller?.abort()
  finish(false)
}

/** 收尾：关闭弹窗、复位状态并兑现 promise */
function finish(result) {
  controller?.abort()
  controller = null
  scanning.value = false
  visible.value = false
  errorMsg.value = ''
  const r = resolver
  resolver = null
  if (r) r(result)
}

export function useBiometricPrompt() {
  return {
    // 状态（供 BiometricPrompt 组件绑定）
    visible,
    mode,
    scanning,
    errorMsg,
    native,
    // 方法
    requestBiometric,
    startScan,
    cancel
  }
}
