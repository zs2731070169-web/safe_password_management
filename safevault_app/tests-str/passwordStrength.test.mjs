/**
 * FE-STR 密码强度评估单测（以 utils/passwordStrength.js 实际代码行为为基线）。
 *
 * 代码分级规则（evaluatePasswordLevel，返回 0~4）：
 *   0 空密码
 *   1 弱   —— len<8 或 variety<=1
 *   2 中   —— len<12 或 variety===2
 *   3 强   —— variety===3
 *   4 很强 —— len>=12 且 variety===4
 * variety = 是否含 [小写]/[大写]/[数字]/[非字母数字] 四类各计 1。
 *
 * 注意（偏差 DEF-STR）：实现未接入「常见弱口令库命中」判定，纯长度+字符种类。本组用例
 * 按代码实际行为断言，不以 PRD 弱口令库要求判 Fail。
 */
import { describe, it, expect } from 'vitest'
import { evaluatePasswordLevel, STRENGTH_LEVEL_TEXT } from '@/utils/passwordStrength'

describe('evaluatePasswordLevel - 边界与等价类', () => {
  it('FE-STR-01 空/undefined/null → 0', () => {
    expect(evaluatePasswordLevel('')).toBe(0)
    expect(evaluatePasswordLevel(undefined)).toBe(0)
    expect(evaluatePasswordLevel(null)).toBe(0)
  })

  it('FE-STR-02 纯数字短（123456，len6 variety1）→ 1 弱', () => {
    // 内置样本 GitHub 弱密码 123456 的等价场景
    expect(evaluatePasswordLevel('123456')).toBe(1)
  })

  it('FE-STR-03 len<8 即便多类仍为 1 弱（Ab1!，len4 variety4）', () => {
    expect(evaluatePasswordLevel('Ab1!')).toBe(1)
  })

  it('FE-STR-04 variety<=1 即便很长仍为 1 弱（20个小写 a）', () => {
    expect(evaluatePasswordLevel('a'.repeat(20))).toBe(1)
  })

  it('FE-STR-05 len>=8 且 variety===2，len<12 → 2 中（abc12345，len8 variety2）', () => {
    expect(evaluatePasswordLevel('abc12345')).toBe(2)
  })

  it('FE-STR-06 variety===2 即便 len>=12 仍为 2 中（abcdefghij12，len12 variety2）', () => {
    expect(evaluatePasswordLevel('abcdefghij12')).toBe(2)
  })

  it('FE-STR-07 8<=len<12 且 variety===3 → 2 中（边界：len<12 优先于 variety===3）', () => {
    // Abc12345 长度8 variety3，因 len<12 命中「中」分支早于 variety===3
    expect(evaluatePasswordLevel('Abc12345')).toBe(2)
  })

  it('FE-STR-08 len>=12 且 variety===3 → 3 强（Abcdefghij12，len12 variety3）', () => {
    expect(evaluatePasswordLevel('Abcdefghij12')).toBe(3)
  })

  it('FE-STR-09 len>=12 且 variety===4 → 4 很强（Welcome@2024X，含四类且长度>=12）', () => {
    expect(evaluatePasswordLevel('Welcome@2024X')).toBe(4)
  })

  it('FE-STR-10 重复密码 Welcome@2024（len12 四类）→ 4（强度算法不感知重复，重复由 health 处理）', () => {
    expect(evaluatePasswordLevel('Welcome@2024')).toBe(4)
  })

  it('FE-STR-11 文案数组与等级对齐', () => {
    expect(STRENGTH_LEVEL_TEXT).toEqual(['', '弱', '中', '强', '很强'])
  })
})
