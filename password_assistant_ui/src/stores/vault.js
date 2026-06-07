import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 回收站保留天数：条目移入回收站后可恢复的窗口期（DRD「30 天内可恢复」）。
 * 超期条目应被永久清除；当前为纯前端 mock，不做后台定时清理，仅用于展示「剩余 N 天」。
 */
export const TRASH_RETENTION_DAYS = 30

/**
 * 密码库 Store
 *
 * 持有密码条目列表、分类筛选与搜索状态，并对外提供取出明文密码的能力；
 * 同时托管「回收站」：删除条目为软删除（移入回收站），支持恢复 / 彻底删除 / 清空。
 * 当前为纯前端 mock：条目数据与明文均为本地模拟，真实接入时
 * 仅替换文件末尾的 mock 实现（拉取列表 / 解密取明文 / 回收站初始数据），视图与 composable 不动。
 */
export const useVaultStore = defineStore('vault', () => {
  // ---------------------------------------------------------------
  // state
  // ---------------------------------------------------------------
  /** 全部密码条目 */
  const entries = ref(mockEntries())
  /**
   * 回收站条目（软删除区）。每项在原条目字段基础上追加 deletedAt（删除时刻 ms 时间戳），
   * 供「剩余可恢复天数」计算。不参与主列表 / 筛选 / 健康度诊断。
   */
  const trashedEntries = ref(mockTrashedEntries())
  /** 当前选中分类（'all' 表示全部） */
  const activeCategory = ref('all')
  /** 搜索关键词 */
  const keyword = ref('')

  /** 分类定义（顺序即展示顺序，all 固定置首） */
  const categories = ref([
    { key: 'all', label: '全部' },
    { key: 'social', label: '社交' },
    { key: 'finance', label: '金融' },
    { key: 'shopping', label: '购物' },
    { key: 'work', label: '工作' },
    { key: 'email', label: '邮箱' }
  ])

  // ---------------------------------------------------------------
  // getters
  // ---------------------------------------------------------------
  /** 按分类 + 关键词过滤后的条目 */
  const filteredEntries = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    return entries.value.filter((item) => {
      const matchCategory =
        activeCategory.value === 'all' || item.category === activeCategory.value
      const matchKeyword =
        !kw ||
        item.name.toLowerCase().includes(kw) ||
        item.account.toLowerCase().includes(kw)
      return matchCategory && matchKeyword
    })
  })

  // ---------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------
  /** 切换分类 */
  function setCategory(key) {
    activeCategory.value = key
  }

  /**
   * 新增分类标签
   * 用户在新增密码页输入了候选中不存在的分类时调用，自动并入分类列表。
   * 同名（忽略大小写与首尾空格）已存在则直接返回已有项，不重复添加。
   * @param {string} label 分类显示名
   * @returns {object | null} 新建或已存在的分类；label 为空时返回 null
   */
  function addCategory(label) {
    const text = (label ?? '').trim()
    if (!text) return null
    const existed = categories.value.find(
      (c) => c.label.toLowerCase() === text.toLowerCase()
    )
    if (existed) return existed
    const category = { key: deriveCategoryKey(text, categories.value), label: text }
    categories.value.push(category)
    return category
  }

  /** 设置搜索关键词 */
  function setKeyword(value) {
    keyword.value = value
  }

  /**
   * 取出指定条目的明文密码（mock）
   * 真实接入时此处走解密 / 后端取值。
   * @param {string} id 条目 id
   * @returns {string} 明文密码
   */
  function getSecret(id) {
    return mockSecret(id)
  }

  /**
   * 按 id 取单条条目（详情页用）
   * @param {string} id 条目 id
   * @returns {object | null}
   */
  function getEntry(id) {
    return entries.value.find((item) => item.id === id) ?? null
  }

  /**
   * 删除指定条目（软删除：移入回收站，30 天内可恢复）
   * 从主列表移除并追加 deletedAt 后压入回收站顶部（最近删除在前）。
   * @param {string} id 条目 id
   * @returns {boolean} 是否删除成功
   */
  function deleteEntry(id) {
    const index = entries.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    const [removed] = entries.value.splice(index, 1)
    trashedEntries.value.unshift({ ...removed, deletedAt: Date.now() })
    return true
  }

  /**
   * 从回收站恢复条目：移出回收站、剥离 deletedAt 后置顶回主列表。
   * @param {string} id 条目 id
   * @returns {boolean} 是否恢复成功
   */
  function restoreEntry(id) {
    const index = trashedEntries.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    const [restored] = trashedEntries.value.splice(index, 1)
    const { deletedAt, ...entry } = restored // 丢弃回收站元数据
    entries.value.unshift(entry)
    return true
  }

  /**
   * 彻底删除回收站中的某条目（不可恢复）。
   * @param {string} id 条目 id
   * @returns {boolean} 是否删除成功
   */
  function purgeEntry(id) {
    const index = trashedEntries.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    trashedEntries.value.splice(index, 1)
    return true
  }

  /**
   * 清空回收站（彻底删除全部，不可恢复）。
   * @returns {number} 被清除的条目数
   */
  function emptyTrash() {
    const count = trashedEntries.value.length
    trashedEntries.value = []
    return count
  }

  /**
   * 新增密码条目（mock）
   * 真实接入时此处走加密入库 / 后端写入。
   * @param {{ name: string, account?: string, password: string, url?: string, category?: string, note?: string }} payload
   * @returns {object} 新建的条目
   */
  function addEntry(payload) {
    const entry = mockCreateEntry(payload, entries.value)
    entries.value.unshift(entry) // 置顶以呼应「最近更新」
    return entry
  }

  /**
   * 更新现有密码条目（mock）
   * id 保持不变，按新名称重算图标字标；真实接入时此处走加密回写。
   * @param {string} id 条目 id
   * @param {{ name: string, account?: string, password: string, url?: string, category?: string, note?: string }} payload
   * @returns {object | null} 更新后的条目，id 不存在时返回 null
   */
  function updateEntry(id, payload) {
    const target = entries.value.find((item) => item.id === id)
    if (!target) return null
    target.name = (payload.name ?? '').trim()
    target.monogram = deriveMonogram(target.name)
    target.account = (payload.account ?? '').trim()
    target.password = payload.password ?? ''
    target.url = (payload.url ?? '').trim()
    target.category = (payload.category ?? '').trim()
    target.note = (payload.note ?? '').trim()
    return target
  }

  return {
    // state
    entries,
    trashedEntries,
    activeCategory,
    keyword,
    categories,
    // getters
    filteredEntries,
    // actions
    setCategory,
    addCategory,
    setKeyword,
    getSecret,
    getEntry,
    deleteEntry,
    restoreEntry,
    purgeEntry,
    emptyTrash,
    addEntry,
    updateEntry
  }
})

// ===============================================================
// 以下为 mock 实现，真实接入时替换即可
// ===============================================================

/** 模拟密码条目列表（account / password 均为真实明文，展示脱敏由 settings.maskAccount 动态控制） */
function mockEntries() {
  return [
    {
      id: 'apple',
      name: 'Apple ID',
      monogram: 'A',
      account: 'david@icloud.com',
      password: 'Ap9!eSecure2024',
      url: 'https://appleid.apple.com',
      category: 'email'
    },
    {
      id: 'github',
      name: 'GitHub',
      monogram: 'G',
      account: 'dev_master',
      password: '123456', // 弱密码样本：纯数字 6 位，强度规则判为「弱」
      url: 'https://github.com',
      category: 'work'
    },
    {
      id: 'hsbc',
      name: 'HSBC Bank',
      monogram: 'H',
      account: '8888123456781234',
      password: 'Hsbc$Bank8888',
      url: 'https://www.hsbc.com.hk',
      category: 'finance'
    },
    {
      id: 'wechat',
      name: '微信 (WeChat)',
      monogram: '微',
      account: 'wxid_abc8293',
      password: 'Welcome@2024', // 与 YouTube 共用同一密码，构成「重复使用」样本
      url: 'https://weixin.qq.com',
      category: 'social'
    },
    {
      id: 'youtube',
      name: 'YouTube',
      monogram: 'Y',
      account: 'creator@gmail.com',
      password: 'Welcome@2024', // 与微信重复
      url: 'https://youtube.com',
      category: 'social'
    }
  ]
}

/** 模拟取明文密码 */
function mockSecret(id) {
  const entry = mockEntries().find((item) => item.id === id)
  return entry?.password ?? ''
}

/** 一天的毫秒数（回收站「剩余天数」计算用） */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 模拟回收站初始条目（对齐 DRD 4.12「回收站 3 条」）。
 * deletedAt 以「当前时间往前推 N 天」生成，刻意覆盖刚删除 / 删除较久 / 临近到期三档，
 * 便于查看「剩余 N 天」与临期高亮。真实接入时改为从后端 / 本地库读取回收站数据。
 * @returns {object[]}
 */
function mockTrashedEntries() {
  const now = Date.now()
  return [
    {
      id: 'trash-netflix',
      name: 'Netflix',
      monogram: 'N',
      account: 'family@gmail.com',
      password: 'NflxWatch#2023',
      url: 'https://netflix.com',
      category: 'shopping',
      note: '',
      deletedAt: now - 1 * DAY_MS // 1 天前删除，剩余 29 天
    },
    {
      id: 'trash-dropbox',
      name: 'Dropbox',
      monogram: 'D',
      account: 'david_w',
      password: 'Dbx!Storage9',
      url: 'https://dropbox.com',
      category: 'work',
      note: '',
      deletedAt: now - 12 * DAY_MS // 12 天前删除，剩余 18 天
    },
    {
      id: 'trash-twitter',
      name: 'X (Twitter)',
      monogram: 'X',
      account: 'dev_master',
      password: 'oldPass123', // 旧弱密码样本（已不在主库，不计入健康度）
      url: 'https://x.com',
      category: 'social',
      note: '',
      deletedAt: now - 28 * DAY_MS // 28 天前删除，剩余 2 天（临期）
    }
  ]
}

/**
 * 模拟根据表单构造一条新条目
 * 真实接入时由后端返回完整条目（含 id），此处用「现有条数 + 名称」派生 id 占位，
 * 避免依赖运行时时间戳。
 * @param {object} payload 表单字段
 * @param {object[]} existing 现有条目（用于生成不重复的占位 id）
 * @returns {object}
 */
function mockCreateEntry(payload, existing) {
  const name = (payload.name ?? '').trim()
  return {
    id: `entry-${existing.length + 1}-${name.toLowerCase().replace(/\s+/g, '-') || 'item'}`,
    name,
    monogram: deriveMonogram(name),
    account: (payload.account ?? '').trim(),
    password: payload.password ?? '',
    url: (payload.url ?? '').trim(),
    category: (payload.category ?? '').trim(),
    note: (payload.note ?? '').trim()
  }
}

/** 取名称首个有效字符作为图标字母（中英文皆可，空则回退占位） */
function deriveMonogram(name) {
  const first = (name ?? '').trim().charAt(0)
  return first ? first.toUpperCase() : '#'
}

/**
 * 为新分类派生唯一 key
 * 优先取 ASCII slug（如 "Game Center" → "game-center"）；
 * 中文等无 ASCII 字符时回退自增占位 key，并保证与现有 key 不冲突。
 * @param {string} label 分类显示名
 * @param {object[]} existing 现有分类列表
 * @returns {string}
 */
function deriveCategoryKey(label, existing) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = slug || `custom-${existing.length}`
  let key = base
  let i = 2
  while (existing.some((c) => c.key === key)) {
    key = `${base}-${i++}`
  }
  return key
}
