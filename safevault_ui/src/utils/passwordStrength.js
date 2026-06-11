/**
 * 密码强度评估 —— 全局唯一规则
 *
 * 统计字符种类数（小写 / 大写 / 数字 / 特殊，0~4 类）并结合长度分级，输出 0~4 级：
 *   0 等待输入（空密码）
 *   1 弱   —— 长度 < 8 或仅 1 类字符
 *   2 中   —— 长度 < 12 或恰好 2 类
 *   3 强   —— 3 类字符
 *   4 很强 —— ≥12 位且 4 类齐全
 *
 * 全工程共用同一套规则，禁止各处再各自复制实现：
 *   - views/recovery/components/PasswordStrength.vue（重设主密码强度计）
 *   - views/add/components/GeneratePasswordField.vue（新增 / 编辑密码强度条）
 *   - stores/health.js（健康检测的弱密码诊断与融合算分）
 */

/** 各等级文案（索引即 level；0 表示空，空态文案由调用方按场景自行决定） */
export const STRENGTH_LEVEL_TEXT = ['', '弱', '中', '强', '很强']

/**
 * 评估密码强度等级
 * @param {string} password 待评估密码
 * @returns {number} 强度等级 0~4（0 表示空密码）
 */
export function evaluatePasswordLevel(password) {
  const pw = password || ''
  if (!pw) return 0

  // 字符种类数（小写 / 大写 / 数字 / 特殊）
  let variety = 0
  if (/[a-z]/.test(pw)) variety++
  if (/[A-Z]/.test(pw)) variety++
  if (/\d/.test(pw)) variety++
  if (/[^A-Za-z0-9]/.test(pw)) variety++

  const len = pw.length
  if (len < 8 || variety <= 1) return 1 // 弱
  if (len < 12 || variety === 2) return 2 // 中
  if (variety === 3) return 3 // 强
  return 4 // 很强（≥12 位且四类齐全）
}
