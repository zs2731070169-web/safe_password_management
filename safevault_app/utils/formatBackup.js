/**
 * 备份元信息展示格式化工具（模块 2 §3 GET /backup/meta 的展示层）
 *
 * 把后端返回的原始元信息（size 字节数 / updatedAt ISO 时间）格式化成设置页云账户卡片那行
 * 「上次备份：刚刚 · 12 KB · v8」里的人类可读片段。纯函数、无副作用，便于复用与单测。
 */

/**
 * 把字节数格式化为人类可读体积（B / KB / MB）。
 *
 * 取 1024 进制（与系统「KB」习惯一致）；KB 及以上保留至多 1 位小数并去掉多余的 .0，
 * 使「12288 → 12 KB」「1536 → 1.5 KB」这类常见值简洁好读。
 *
 * @param {number|null|undefined} bytes 字节数（来自后端 size，即库列 size_bytes）
 * @returns {string} 如 '0 B' / '512 B' / '12 KB' / '1.5 KB' / '3.2 MB'；非法输入回落空串
 */
export function formatSize(bytes) {
  // 非数值 / 负数 / NaN 一律按「无可展示」回落空串，避免卡片出现 'NaN KB'
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`

  const kb = bytes / 1024
  if (kb < 1024) return `${trimZero(kb)} KB`

  const mb = kb / 1024
  return `${trimZero(mb)} MB`
}

/**
 * 保留至多 1 位小数并去掉末尾的 .0（12.0 → '12'、1.5 → '1.5'）。
 * @param {number} n
 * @returns {string}
 */
function trimZero(n) {
  // toFixed(1) 先归一到 1 位小数，再用 Number 去掉 '12.0' 的多余零，最后转回字符串
  return String(Number(n.toFixed(1)))
}

/**
 * 把时间格式化为相对「上次备份」时间（刚刚 / x 分钟前 / x 小时前 / x 天前 / 具体日期）。
 *
 * 设计为对「上次备份」语境友好：1 分钟内「刚刚」，1 小时内按分钟，24 小时内按小时，30 天内按天，
 * 更久则回落到「YYYY-MM-DD」具体日期（相对时间过久反而不直观）。未来时间（时钟偏差）按「刚刚」兜底。
 *
 * @param {string|number|Date|null|undefined} input 后端 ISO 8601 字符串 / 时间戳 / Date
 * @param {number} [now=Date.now()] 当前时间戳（可注入，便于单测确定性）
 * @returns {string} 相对时间文案；非法输入回落空串
 */
export function formatRelativeTime(input, now = Date.now()) {
  if (input == null || input === '') return ''
  const ts = input instanceof Date ? input.getTime() : new Date(input).getTime()
  // 解析失败（Invalid Date → NaN）回落空串，不展示
  if (Number.isNaN(ts)) return ''

  const diffMs = now - ts
  // 未来时间（设备时钟偏差 / 服务端时间略超前）：按「刚刚」兜底，不展示「-x 分钟前」
  if (diffMs < 0) return '刚刚'

  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return '刚刚'

  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`

  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`

  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`

  // 超过 30 天：相对时间不再直观，回落到具体日期 YYYY-MM-DD
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 把备份元信息组装成卡片副信息一行：「上次备份：刚刚 · 12 KB · v8」。
 *
 * 据 backupMeta 缓存的三态生成文案：
 *   - null（尚未拉取）→ 空串（卡片不展示副信息，由调用方决定是否显占位）
 *   - { hasBackup: false } → '尚未备份'
 *   - { hasBackup: true, ... } → '上次备份：<相对时间> · <体积> · v<版本>'（缺字段的片段自动省略）
 *
 * @param {null | { hasBackup: boolean, version?: number, size?: number, updatedAt?: string }} meta
 * @param {number} [now=Date.now()] 当前时间戳（透传给相对时间格式化，便于单测）
 * @returns {string} 卡片副信息文案
 */
export function formatBackupSummary(meta, now = Date.now()) {
  if (!meta) return ''
  if (!meta.hasBackup) return '尚未备份'

  // 三个片段按「时间 · 体积 · 版本」拼接，缺失的片段过滤掉（容忍后端个别字段为空）
  const parts = []
  const rel = formatRelativeTime(meta.updatedAt, now)
  if (rel) parts.push(rel)
  const size = formatSize(meta.size)
  if (size) parts.push(size)
  if (typeof meta.version === 'number') parts.push(`v${meta.version}`)

  // 全部片段缺失时仍给出「已备份」兜底，避免出现「上次备份：」后空白
  if (parts.length === 0) return '已备份'
  return `上次备份：${parts.join(' · ')}`
}
