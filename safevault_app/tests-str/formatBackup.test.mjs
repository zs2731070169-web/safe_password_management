/**
 * FE-FMT 备份元信息格式化单测（以 utils/formatBackup.js 实际代码行为为基线）。
 * 覆盖 formatSize / formatRelativeTime / formatBackupSummary 三个纯函数。
 * 时间相关用例注入固定 now，保证确定性。
 */
import { describe, it, expect } from 'vitest'
import { formatSize, formatRelativeTime, formatBackupSummary } from '@/utils/formatBackup'

describe('formatSize', () => {
  it('FE-FMT-01 <1024 按 B', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1023)).toBe('1023 B')
  })
  it('FE-FMT-02 KB 去 .0（12288→12 KB）保留1位（1536→1.5 KB）', () => {
    expect(formatSize(12288)).toBe('12 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024)).toBe('1 KB')
  })
  it('FE-FMT-03 MB（>=1024*1024）', () => {
    expect(formatSize(3.2 * 1024 * 1024)).toBe('3.2 MB')
  })
  it('FE-FMT-04 非法输入回落空串（NaN/负数/非数值/null）', () => {
    expect(formatSize(NaN)).toBe('')
    expect(formatSize(-1)).toBe('')
    expect(formatSize('100')).toBe('')
    expect(formatSize(null)).toBe('')
    expect(formatSize(undefined)).toBe('')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-13T12:00:00Z').getTime()
  it('FE-FMT-05 60s 内 → 刚刚', () => {
    expect(formatRelativeTime(new Date(now - 30 * 1000), now)).toBe('刚刚')
  })
  it('FE-FMT-06 分钟级', () => {
    expect(formatRelativeTime(new Date(now - 5 * 60 * 1000), now)).toBe('5 分钟前')
  })
  it('FE-FMT-07 小时级', () => {
    expect(formatRelativeTime(new Date(now - 3 * 3600 * 1000), now)).toBe('3 小时前')
  })
  it('FE-FMT-08 天级（<30天）', () => {
    expect(formatRelativeTime(new Date(now - 5 * 86400 * 1000), now)).toBe('5 天前')
  })
  it('FE-FMT-09 >=30天回落具体日期 YYYY-MM-DD', () => {
    const old = new Date('2026-01-01T08:00:00')
    const r = formatRelativeTime(old, now)
    expect(r).toBe('2026-01-01')
  })
  it('FE-FMT-10 未来时间（时钟偏差）→ 刚刚', () => {
    expect(formatRelativeTime(new Date(now + 10000), now)).toBe('刚刚')
  })
  it('FE-FMT-11 非法/空输入回落空串', () => {
    expect(formatRelativeTime(null, now)).toBe('')
    expect(formatRelativeTime('', now)).toBe('')
    expect(formatRelativeTime('not-a-date', now)).toBe('')
  })
})

describe('formatBackupSummary', () => {
  const now = new Date('2026-06-13T12:00:00Z').getTime()
  it('FE-FMT-12 null（未拉取）→ 空串', () => {
    expect(formatBackupSummary(null, now)).toBe('')
  })
  it('FE-FMT-13 hasBackup:false → 尚未备份', () => {
    expect(formatBackupSummary({ hasBackup: false }, now)).toBe('尚未备份')
  })
  it('FE-FMT-14 完整三段拼接「上次备份：时间 · 体积 · v版本」', () => {
    const meta = {
      hasBackup: true,
      version: 8,
      size: 12288,
      updatedAt: new Date(now - 30 * 1000).toISOString(),
    }
    expect(formatBackupSummary(meta, now)).toBe('上次备份：刚刚 · 12 KB · v8')
  })
  it('FE-FMT-15 缺字段自动省略片段（仅 version）', () => {
    const meta = { hasBackup: true, version: 2 }
    expect(formatBackupSummary(meta, now)).toBe('上次备份：v2')
  })
  it('FE-FMT-16 全片段缺失但 hasBackup:true → 已备份兜底', () => {
    expect(formatBackupSummary({ hasBackup: true }, now)).toBe('已备份')
  })
})
