/**
 * secureCredential —— 「设备安全区」凭据存储抽象层（指纹登录的核心依赖）
 *
 * 背景：SafeVault 是零知识密码库——主密码既用于**认证云账户**（派生 verifier 换 token），
 * 又用于**解密保险库**（派生 DataKey 解 blob）。因此「指纹登录」不能只是翻一个本地标志位，
 * 也不能只靠 refreshToken 续签（那样拿得到 token 却没有 DataKey，解不开自己的库）。
 *
 * 正确模型（业界标准，1Password / Bitwarden 同款）：
 *   指纹只是「解锁本设备安全区里存的主密码」的闸门。指纹通过 → 取回主密码 → 走与密码登录
 *   完全相同的链路（派生 verifier 认证 + 派生 DataKey 解密）。即「指纹登录 = 密码不用手敲，
 *   由安全区提供」。
 *
 * 本文件即「真实接入点」：
 *   - 【当前 mock】用一个**独立的** localStorage key 暂存 { email, password }，与业务凭据
 *     （safevault.cloud）隔离，便于演示。指纹闸门由调用方（useUnlock / useSettings 在调用
 *     loadSecureCredential 前先 requestBiometric）保证。
 *   - 【真机接入】把下面三个函数改为对接 iOS Keychain / Android Keystore（如
 *     @capgo/capacitor-native-biometric 的 setCredentials/getCredentials/deleteCredentials），
 *     并把读取设为**生物识别保护**（getCredentials 时系统自动弹指纹）。届时 loadSecureCredential
 *     变为异步、读取动作本身即闸门，上层 await 不变即可；hasSecureCredential 可改读一个
 *     「是否已存」的非敏感标记位。
 *
 * 安全说明：把主密码放进硬件背书的 Keystore/Keychain，是「设备失陷 + 指纹绕过才暴露」的
 * 标准权衡，与 1Password/Bitwarden 一致；绝不可用明文 localStorage 长期存放（仅 mock 演示）。
 */

/** localStorage 持久化 key（与业务凭据 safevault.cloud 隔离） */
const SECURE_KEY = 'safevault.secure'

/**
 * 写入安全区凭据（开启指纹登录时调用，调用前应已通过指纹录入校验）。
 * 真机接入：改为 NativeBiometric.setCredentials({ username, password, server })。
 * @param {{ email: string, password: string }} cred
 */
export function saveSecureCredential({ email, password }) {
  try {
    localStorage.setItem(SECURE_KEY, JSON.stringify({ email, password }))
  } catch {
    // 隐私模式 / 配额异常时静默降级（上层据 hasSecureCredential 兜底）
  }
}

/**
 * 取回安全区凭据（指纹登录时调用，调用前应已通过指纹验证）。
 * 真机接入：改为 await NativeBiometric.getCredentials(...)（读取动作本身即指纹闸门）。
 * @returns {{ email: string, password: string } | null} 无存档返回 null
 */
export function loadSecureCredential() {
  try {
    const raw = localStorage.getItem(SECURE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.email || !parsed?.password) return null
    return { email: parsed.email, password: parsed.password }
  } catch {
    return null
  }
}

/**
 * 清除安全区凭据（关闭指纹 / 退出登录 / 改密 / 重置密码等使旧主密码失效的场景调用）。
 * 真机接入：改为 NativeBiometric.deleteCredentials({ server })。
 */
export function clearSecureCredential() {
  try {
    localStorage.removeItem(SECURE_KEY)
  } catch {
    // 静默
  }
}

/**
 * 安全区是否存有凭据（同步，供路由 / 视图判断「能否指纹登录」的入口显隐）。
 * 真机接入：可改读一个非敏感的「已存」标记位（避免每次都触发指纹弹窗）。
 * @returns {boolean}
 */
export function hasSecureCredential() {
  try {
    return Boolean(localStorage.getItem(SECURE_KEY))
  } catch {
    return false
  }
}
