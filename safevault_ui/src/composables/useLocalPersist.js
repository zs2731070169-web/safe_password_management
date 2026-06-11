/**
 * 本地加密持久化编排 —— 整库变更即加密落盘，登录后解密秒恢复
 *
 * 把「库变更 → 防抖合并 → 加密落盘」与「登录 → 解密恢复」两条链路收敛成一个在应用持久根
 * （App.vue）激活一次的监听器。与 useCloudBackup / useCloudHydrate 对称、互补：
 *   - useCloudBackup / useCloudHydrate：整库密文走**云端**，受「云备份」开关 + 网络约束；
 *   - 本模块：整库密文存**本机** localStorage，只看是否已登录，不依赖网络、不受开关门控。
 *
 * 这样即便关闭云备份 / 云端不可达，本机改动（条目 / 回收站 / 分类）也已加密落地，重新登录后
 * 立即恢复，根治 vault store 三态纯内存「刷新即回落 mock」。
 *
 * 恢复时序：登录瞬间本模块同步从本地密文秒填（离线兜底 / 即时可见）；若开启云备份且云端可达，
 * useCloudHydrate 随后按「下载优先」语义以云端权威值覆盖（不引入版本比对）。两者各自触发的回写
 * 均为同数据、无害（skipNextSave 进一步抑制本模块填充后的首次回写）。
 */
import { watch } from 'vue'
import { useVaultStore } from '@/stores/vault'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { saveLocalVault, loadLocalVault } from '@/services/localVault'

/** 防抖窗口（毫秒）：连续编辑合并为一次落盘。本地加密成本低（DataKey 已缓存），取较短窗口更快落地。 */
const DEBOUNCE_MS = 600

/**
 * 在持久组件（App.vue）的 setup 中调用一次，激活本地加密持久化监听。
 */
export function useLocalPersist() {
  const vault = useVaultStore()
  const account = useCloudAccountStore()

  let timer = null
  // 一次性跳过标志：恢复时 replaceFromSnapshot 会触发落盘 watch，抑制这次「把刚读出的同样数据写回」。
  let skipNextSave = false

  /** 组装当前整库快照（结构与 services/cloudBackup.buildSnapshot 对称） */
  function buildSnapshot() {
    return {
      schema: 1,
      exportedAt: Date.now(),
      entries: vault.entries,
      trash: vault.trashedEntries,
      categories: vault.categories
    }
  }

  /** 执行一次加密落盘（仅已登录时） */
  async function runSave() {
    timer = null
    if (!account.loggedIn) return
    await saveLocalVault(account, buildSnapshot())
  }

  /** 调度一次防抖落盘（库变更时调用） */
  function schedule() {
    if (!account.loggedIn) return
    // 恢复触发的首次变更：跳过一次，避免把刚读出的同样数据立刻写回
    if (skipNextSave) {
      skipNextSave = false
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(runSave, DEBOUNCE_MS)
  }

  /** 登录后从本地密文解密恢复整库（有则覆盖内存态） */
  async function restore() {
    const snapshot = await loadLocalVault(account)
    if (snapshot) {
      // 标记跳过紧接着由 replaceFromSnapshot 触发的那次落盘（同数据回写无意义）
      skipNextSave = true
      vault.replaceFromSnapshot(snapshot)
    }
  }

  // 监听登录完成：loggedIn 启动恒为 false（会话态不持久化），重新登录才触发。
  // 非 immediate：避免应用启动 / store 初始化时空跑（仅真正登录那一刻触发一次）。
  watch(
    () => account.loggedIn,
    (now, was) => {
      if (now && !was) restore()
    }
  )

  // 深度监听整库三态（活跃条目 + 回收站 + 分类）任一变更 → 防抖加密落盘。
  // 不使用 immediate：避免应用启动 / store 初始化时空跑一次（仅真正发生变更才触发）。
  watch(
    () => [vault.entries, vault.trashedEntries, vault.categories],
    schedule,
    { deep: true }
  )
}
