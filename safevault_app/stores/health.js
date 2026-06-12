import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useVaultStore } from '@/stores/vault'
import { evaluatePasswordLevel } from '@/utils/passwordStrength'

/**
 * 健康度 Store
 *
 * 持有密码健康分、上次检测时间与问题清单，并按严重度划分「问题卡」与「安全建议」。
 * 诊断与算分均基于密码库（vault store）真实条目的密码，采用与「密码强度计 / 生成器」
 * 完全相同的一套强度规则（utils/passwordStrength），再叠加「重复使用」检测；
 * 健康总分由各条目强度等级融合为 0-100。
 *
 * 诊断 / 算分逻辑（强度规则 + 重复检测）全部基于密码库真实条目，不含任何写死的演示数据。
 *
 * 问题清单不凭空捏造：诊断只针对库中真实存在的条目，名称、修复入口均取自该条目，
 * 条目被删除 / 改强时对应问题项随之消失，健康分实时重算（DRD HLT-05）。
 *
 * 安全约束（DRD HLT-06）：检测全程本地完成、不上传任何密码，问题清单不含明文。
 */
export const useHealthStore = defineStore('health', () => {
  const vault = useVaultStore()

  // ---------------------------------------------------------------
  // state
  // ---------------------------------------------------------------
  /** 健康分（0-100）：由各条目强度等级融合 + 重复惩罚实时派生 */
  const score = computed(() => computeScore(vault.entries))
  /** 上次检测时间（展示文案） */
  const lastScan = ref('刚刚')
  /**
   * 问题清单（按真实密码库条目 + 诊断结论派生，已按严重度排序：弱 > 重复 > 中 > 建议）
   * 每项：{ id, name, type, severity, tag, icon, target }
   *   severity: 'weak'（弱，红）| 'dup'（重复，橙）| 'medium'（中等强度，橙）| 'insight'（安全建议，虚线卡）
   *   target:   修复入口指向的密码条目 id（与真实条目 id 一致；insight 类无）
   */
  const problems = computed(() => buildProblems(vault.entries))
  /** 搜索关键词（按问题项名称 / 类型过滤） */
  const keyword = ref('')

  // ---------------------------------------------------------------
  // getters
  // ---------------------------------------------------------------
  /** 需以问题卡渲染的条目（弱 / 重复） */
  const issues = computed(() =>
    problems.value.filter((item) => item.severity !== 'insight')
  )

  /** 按关键词过滤后的问题项（关键词为空时返回全部） */
  const filteredIssues = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    if (!kw) return issues.value
    return issues.value.filter(
      (item) =>
        item.name.toLowerCase().includes(kw) ||
        item.type.toLowerCase().includes(kw)
    )
  })

  /** 安全建议（虚线卡），无则为 null */
  const insight = computed(
    () => problems.value.find((item) => item.severity === 'insight') ?? null
  )

  /** 问题数（对应「问题清单 (n)」，按当前实际展示的问题项计，随搜索过滤变化） */
  const problemCount = computed(() => filteredIssues.value.length)

  /** 分档（strong / good / weak，区间见 DRD 2.1.3） */
  const scoreLevel = computed(() => {
    if (score.value >= 90) return 'strong'
    if (score.value >= 60) return 'good'
    return 'weak'
  })

  /** 分档文字 */
  const scoreLevelLabel = computed(
    () => ({ strong: '优秀', good: '良好', weak: '需改善' })[scoreLevel.value]
  )

  // ---------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------
  /** 设置搜索关键词 */
  function setKeyword(value) {
    keyword.value = value
  }

  /**
   * 重新检测
   * 分数与问题清单均由 vault 真实条目实时派生（强度规则 + 重复检测），此处仅刷新
   * 「上次检测时间」并回传当前快照。真实接入时若改为异步本地扫描，替换内部即可。
   * @returns {{ score: number, count: number }} 最新分数与问题数
   */
  function rescan() {
    lastScan.value = '刚刚'
    // 计数按全部问题项返回（不受当前搜索过滤影响）
    return { score: score.value, count: issues.value.length }
  }

  return {
    // state
    score,
    lastScan,
    problems,
    keyword,
    // getters
    problemCount,
    issues,
    filteredIssues,
    insight,
    scoreLevel,
    scoreLevelLabel,
    // actions
    setKeyword,
    rescan
  }
})

// ===============================================================
// 诊断与算分：基于真实条目密码，复用统一强度规则 + 重复检测
// ===============================================================

/** 各强度等级对应的「健康得分」（融合总分时取均值） */
const LEVEL_SCORE = { 1: 25, 2: 55, 3: 80, 4: 100 }
/** 单个重复条目的扣分 */
const DUP_PENALTY_EACH = 5
/** 重复惩罚封顶（避免重复项过多把分数压到不合理的低位） */
const DUP_PENALTY_CAP = 20

/**
 * 统计「明文密码 -> 使用次数」，用于判定重复使用
 * @param {object[]} entries 密码库条目列表
 * @returns {Record<string, number>}
 */
function countPasswords(entries) {
  const map = {}
  entries.forEach((entry) => {
    const pw = entry.password || ''
    if (pw) map[pw] = (map[pw] || 0) + 1
  })
  return map
}

/**
 * 按真实密码库条目派生问题清单
 *
 * 对每个条目用「同一套强度规则」评级，并结合重复检测给出诊断，健康条目跳过。
 *
 * @param {object[]} entries 密码库条目列表
 * @returns {object[]} 问题清单（弱 > 重复 > 中）
 */
function buildProblems(entries) {
  const pwCount = countPasswords(entries)
  const rank = { weak: 0, dup: 1, medium: 2 }

  return entries
    .map((entry) => diagnose(entry, pwCount))
    .filter(Boolean)
    .sort((a, b) => rank[a.severity] - rank[b.severity])
}

/**
 * 对单个条目诊断：弱密码 > 重复使用 > 中等强度，健康（强 / 很强且不重复）返回 null。
 * 强度等级来自统一规则 evaluatePasswordLevel，与强度计 / 生成器完全一致。
 *
 * @param {object} entry 密码条目
 * @param {Record<string, number>} pwCount 明文使用次数表
 * @returns {object | null} 问题项；健康条目返回 null
 */
function diagnose(entry, pwCount) {
  const level = evaluatePasswordLevel(entry.password)
  const duplicated = (pwCount[entry.password] || 0) > 1
  const base = { id: entry.id, name: entry.name, target: entry.id }

  // 弱密码：风险最高（红）
  if (level === 1) {
    return { ...base, type: '密码强度弱', severity: 'weak', tag: '🔴 弱', icon: 'lock' }
  }
  // 重复使用：同一密码被多个账号共用（橙）
  if (duplicated) {
    return { ...base, type: '与其他账号重复', severity: 'dup', tag: '🟠 重复', icon: 'copy' }
  }
  // 中等强度：可用但建议加强（橙）
  if (level === 2) {
    return { ...base, type: '密码强度中等，建议加强', severity: 'medium', tag: '🟠 中', icon: 'lock' }
  }
  // 强 / 很强且不重复 → 健康，不计入问题清单
  return null
}

/**
 * 融合健康总分（0-100）
 *
 * 取各条目强度等级对应得分的均值作为基础分，再按重复条目数扣分（封顶）。
 * 空密码库视为满分 100。
 *
 * @param {object[]} entries 密码库条目列表
 * @returns {number} 0-100 的整数分
 */
function computeScore(entries) {
  if (!entries.length) return 100

  const pwCount = countPasswords(entries)
  let sum = 0
  let penalty = 0

  entries.forEach((entry) => {
    const level = evaluatePasswordLevel(entry.password) || 1
    sum += LEVEL_SCORE[level] ?? LEVEL_SCORE[1]
    if ((pwCount[entry.password] || 0) > 1) penalty += DUP_PENALTY_EACH
  })

  const base = sum / entries.length
  penalty = Math.min(penalty, DUP_PENALTY_CAP)
  return Math.max(0, Math.min(100, Math.round(base - penalty)))
}
