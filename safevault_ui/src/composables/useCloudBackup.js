/**
 * 云备份触发编排（模块 2 PUT /backup 的前端入口）
 *
 * 把「库变更 → 防抖合并 → 加密上传」这条链路收敛成一个在应用持久根（App.vue）激活一次的监听器：
 *   - 决策点 B：深度监听 vault 的活跃条目 + 回收站条目，**任一增删改**（新增/编辑/软删/恢复/永久删除/
 *     清空）都触发；
 *   - 仅当 `settings.cloudBackup` 开启且已登录时才上传，否则纯本地（对齐 SDD「仅开启云备份时上传」）；
 *   - debounce 2.5s 合并高频改动，只传最终快照一次（连续编辑不刷接口）；
 *   - 开关从「关→开」：立即做一次全量上传（首次备份）。
 *
 * 登录后的会话初始化（下载优先：ok 覆盖本地 / empty 才把本地作首份上传）由 composables/useCloudHydrate
 * 统一编排，本模块**不再于登录时补传**，二者不抢跑（否则补传可能先把本地推上云端、再被下载覆盖，顺序混乱）。
 *
 * 错误处理对齐时序图 §1 优化语义：
 *   - 409（乱序 / 重试旧请求）由 services/cloudBackup 内部判为 stale → **静默丢弃，不弹提示**；
 *   - 413 / 网络等 → ElMessage 轻提示；AbortError（被新一次防抖取消）静默。
 * 自动链路（库变更触发）成功不打扰用户；仅手动 backupNow（开关 / 换机覆盖）成功给「已备份」反馈。
 */
import { watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useVaultStore } from '@/stores/vault'
import { useSettingsStore } from '@/stores/settings'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { pushSnapshot } from '@/services/cloudBackup'

/** 防抖窗口（毫秒）：连续新增 / 编辑合并为一次上传，对齐 SDD「debounce 2–3s」 */
const DEBOUNCE_MS = 2500

/**
 * 在持久组件（App.vue）的 setup 中调用一次，激活云备份监听。返回手动触发入口供设置页 / 换机覆盖使用。
 * @returns {{ backupNow: (opts?: { force?: boolean, silent?: boolean }) => Promise<void> }}
 */
export function useCloudBackup() {
  const vault = useVaultStore()
  const settings = useSettingsStore()
  const account = useCloudAccountStore()

  let timer = null
  let controller = null

  /** 是否具备上传前置（开关开启 + 已登录） */
  const canBackup = () => settings.cloudBackup && account.loggedIn

  /** 执行一次上传（自动链路：成功静默、stale 静默、错误轻提示） */
  async function runAuto() {
    timer = null
    if (!canBackup()) return
    // 取消上一次仍在途的上传，只保留最新快照这一次（防抖合并的兜底）
    controller?.abort()
    controller = new AbortController()
    try {
      await pushSnapshot({ signal: controller.signal })
      // 自动备份成功 / stale 均不打扰用户（仅手动 backupNow 才给成功反馈）
    } catch (err) {
      if (err?.name === 'AbortError') return // 被新一次防抖取消，静默
      ElMessage.error(err?.message || '云备份失败，请稍后重试')
    }
  }

  /** 调度一次防抖上传（库变更时调用） */
  function schedule() {
    if (!canBackup()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(runAuto, DEBOUNCE_MS)
  }

  /**
   * 手动立即上传（不防抖）。用于：开关从关→开的首次全量、登录后补传、换机「用本机覆盖云端」(force)。
   * @param {object} [opts]
   * @param {boolean} [opts.force=false] 显式覆盖云端（换机兜底，须由调用方先做二次确认）
   * @param {boolean} [opts.silent=false] 静默模式（不弹成功提示），用于登录后自动补传
   */
  async function backupNow({ force = false, silent = false } = {}) {
    if (!canBackup()) return
    controller?.abort()
    controller = new AbortController()
    try {
      const res = await pushSnapshot({ force, signal: controller.signal })
      if (res.status === 'ok' && !silent) ElMessage.success('已备份到云端')
      // stale / skipped 不提示（前者是过期上传被静默丢弃，后者是未满足前置）
    } catch (err) {
      if (err?.name === 'AbortError') return
      ElMessage.error(err?.message || '云备份失败，请稍后重试')
    }
  }

  // 决策点 B：深度监听整库（活跃 + 回收站 + 分类）任一变更 → 防抖上传。
  // 含 categories：分类增删改 / 排序也是库的一部分，须随快照上云（否则纯分类改动不触发备份）。
  // 不使用 immediate：避免应用启动 / store 初始化时空跑一次（仅真正发生变更才触发）。
  watch(
    () => [vault.entries, vault.trashedEntries, vault.categories],
    schedule,
    { deep: true }
  )

  // 开关从「关→开」：立即全量上传一次（首次备份），成功给「已备份」反馈。
  watch(
    () => settings.cloudBackup,
    (on, was) => {
      if (on && !was && account.loggedIn) backupNow()
    }
  )

  // 注：登录后的会话初始化（下载优先，empty 才首份上传）交由 useCloudHydrate，本模块不再于登录时补传。

  return { backupNow }
}
