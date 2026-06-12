/**
 * 账号脱敏 —— 全局唯一规则
 *
 * 仅作用于「展示」：把账号字符串中部打码，复制 / 编辑仍使用真实明文。
 * 规则：
 *   - 邮箱（含 @）：保留 local 前 2 位 + 「***」+ 完整域名
 *       david@icloud.com → da***@icloud.com
 *   - 其他（用户名 / 卡号 / 手机号等）：
 *       长度 > 6 → 保留前 3 后 3，中间固定 4 个 *（dev_master → dev****ter）
 *       长度 ≤ 6 → 保留首位 + 「***」（保证至少打码）
 *
 * 由 settings.maskAccount 开关控制是否启用（见 PasswordCard / PasswordDetailView）。
 */

/**
 * 对展示用账号做脱敏
 * @param {string} account 真实账号明文
 * @returns {string} 脱敏后的展示字符串
 */
export function maskAccountText(account) {
  const text = (account ?? '').trim()
  if (!text) return ''

  // 邮箱：保留 local 前 2 位 + 域名
  const at = text.indexOf('@')
  if (at > 0) {
    const head = text.slice(0, Math.min(2, at))
    return `${head}***${text.slice(at)}`
  }

  // 非邮箱
  if (text.length <= 6) {
    return `${text.slice(0, 1)}***`
  }
  return `${text.slice(0, 3)}****${text.slice(-3)}`
}
