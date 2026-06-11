/**
 * 本地加密保险库持久化（零知识）—— 整库快照在本机以密文落盘 localStorage
 *
 * 解决「vault store 三态（活跃条目 / 回收站 / 分类）纯内存、刷新即回落 mock」的根本问题：
 * 登录态下整库变更即加密落盘，重新登录解包出会话 DataKey 后解密秒恢复（明文永不出端）。
 *
 * 包裹式密钥下，整库由 cloudAccount 会话内的**随机 DataKey**（account.getDataKey()）加密——
 * 本模块不再自行按密码派生密钥、也不持有 kdfParams。带来的好处：改密后 DataKey 不变，
 * 本地 blob 持续有效（无需清除重建），消除了「改密后刷新即丢」的窗口。
 *
 * 与 services/cloudBackup.js 互补：cloudBackup 把密文上**云**（受开关 + 网络约束）；本模块存**本机**，
 * 只看是否已登录且会话 DataKey 是否就绪，不依赖网络。
 *
 * 依赖方向：本模块**不静态 import 任何 store**（cloudAccount 反向静态 import 本模块的清理函数）；
 * 需要的会话 DataKey 由调用方以 account 实例传入（account.getDataKey()）。
 */
import { decryptJson, encryptJson } from '@/services/crypto'

/** 本地加密整库持久化 key（与 safevault.* 家族统一前缀；区别于 safevault.backup 的云端状态） */
const STORAGE_KEY = 'safevault.vault'

/** 读取本地加密记录（缺省 / 解析失败回落 null） */
function loadRecord() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.ciphertext) return null
    return {
      owner: parsed.owner ?? null,
      ciphertext: parsed.ciphertext,
      savedAt: parsed.savedAt ?? null
    }
  } catch {
    return null
  }
}

/** 写回本地加密记录（隐私模式 / 配额异常时静默降级，不阻断交互） */
function saveRecord(record) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // 不可用时静默：仅丢失本地持久化，不影响内存态与云备份链路
  }
}

/**
 * 加密落盘整库快照。未登录 / 会话 DataKey 未就绪则静默跳过，不抛。
 * @param {any} account cloudAccount store 实例（提供 loggedIn / email / getDataKey）
 * @param {{ entries: object[], trash: object[], categories: object[] }} snapshot 整库快照
 * @returns {Promise<boolean>} 是否成功落盘
 */
export async function saveLocalVault(account, snapshot) {
  if (!account?.loggedIn) return false
  try {
    const dataKey = await account.getDataKey()
    if (!dataKey) return false // 会话 DataKey 尚未解包，跳过（避免无钥落盘）
    const { ciphertext } = await encryptJson(dataKey, snapshot)
    saveRecord({ owner: account.email, ciphertext, savedAt: Date.now() })
    return true
  } catch {
    return false
  }
}

/**
 * 解密读取本地整库快照。
 * 记录缺失 / owner 不符（换账户）/ 会话 DataKey 未就绪 / 解密失败一律返回 null，不抛。
 * @param {any} account cloudAccount store 实例
 * @returns {Promise<{ entries?: object[], trash?: object[], categories?: object[] } | null>}
 */
export async function loadLocalVault(account) {
  if (!account?.loggedIn) return null
  const record = loadRecord()
  if (!record) return null
  // 按账户隔离：本机 blob 属于其它账户时不解（也解不开），返回 null。
  if (record.owner && record.owner !== account.email) return null
  try {
    const dataKey = await account.getDataKey()
    if (!dataKey) return null // 会话 DataKey 尚未解包（如换机首登等云端水合），留待后续
    return await decryptJson(dataKey, record.ciphertext)
  } catch {
    // 数据损坏 / DataKey 不符：静默返回 null，不抛、不污染调用方
    return null
  }
}

/**
 * 彻底清除本地加密 blob。
 * 用于重置密码（旧会话 DataKey 已清、本机 blob 暂不可解）等场景；改密**不**调用（DataKey 不变、blob 仍有效）。
 */
export function clearLocalVault() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 静默
  }
}

/**
 * 兼容接口（保留供 cloudAccount lock/logout 调用）。
 * 包裹式下会话 DataKey 由 cloudAccount 持有与清理（clearSessionDataKey），本模块不再缓存任何密钥，
 * 故此处为空操作——落盘密文保留，重登解包出 DataKey 后即可解密恢复。
 */
export function clearLocalVaultCache() {
  // no-op：DataKey 缓存已上移至 cloudAccount 会话态
}
