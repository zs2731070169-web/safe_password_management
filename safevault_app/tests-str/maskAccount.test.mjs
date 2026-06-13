/**
 * FE-MSK 账号脱敏单测（以 utils/maskAccount.js 实际代码行为为基线）。
 *
 * 规则：
 *   - 含 @ 且 @ 不在首位：head = 前 min(2, at) 位 + '***' + 从 @ 起的完整域名。
 *   - 非邮箱：len<=6 → 首位 + '***'；len>6 → 前3 + '****' + 后3。
 *   - 空/纯空白 → ''（先 trim）。
 */
import { describe, it, expect } from 'vitest'
import { maskAccountText } from '@/utils/maskAccount'

describe('maskAccountText - 邮箱', () => {
  it('FE-MSK-01 常规邮箱保留 local 前2位 + 完整域名', () => {
    expect(maskAccountText('david@icloud.com')).toBe('da***@icloud.com')
  })

  it('FE-MSK-02 local 仅1位（a@x.com）→ head 取 min(2,1)=1 位', () => {
    expect(maskAccountText('a@x.com')).toBe('a***@x.com')
  })

  it('FE-MSK-03 @ 在首位（@foo）→ at>0 不成立，按非邮箱处理', () => {
    // '@foo' 长度4 <=6 → 首位 '@' + '***'
    expect(maskAccountText('@foo')).toBe('@***')
  })
})

describe('maskAccountText - 非邮箱', () => {
  it('FE-MSK-04 长度>6 保留前3后3中间4星（dev_master）', () => {
    expect(maskAccountText('dev_master')).toBe('dev****ter')
  })

  it('FE-MSK-05 长度=6（abcdef）→ 命中 <=6 分支：首位 + ***', () => {
    expect(maskAccountText('abcdef')).toBe('a***')
  })

  it('FE-MSK-06 长度=7（abcdefg）→ 命中 >6 分支：前3后3', () => {
    expect(maskAccountText('abcdefg')).toBe('abc****efg')
  })

  it('FE-MSK-07 单字符（x）→ 首位 + ***', () => {
    expect(maskAccountText('x')).toBe('x***')
  })
})

describe('maskAccountText - 空与边界', () => {
  it('FE-MSK-08 空串 → 空串', () => {
    expect(maskAccountText('')).toBe('')
  })

  it('FE-MSK-09 null/undefined → 空串', () => {
    expect(maskAccountText(null)).toBe('')
    expect(maskAccountText(undefined)).toBe('')
  })

  it('FE-MSK-10 纯空白先 trim → 空串', () => {
    expect(maskAccountText('   ')).toBe('')
  })

  it('FE-MSK-11 首尾空白被 trim 后再判定（  david@icloud.com  ）', () => {
    expect(maskAccountText('  david@icloud.com  ')).toBe('da***@icloud.com')
  })
})
