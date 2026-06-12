import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'
import { useVaultStore } from '@/stores/vault'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { copyText } from '@/services/clipboard'
import { formatRelativeTime } from '@/utils/formatBackup'

/**
 * useVault —— 密码库交互组合式函数
 *
 * 职责：编排筛选 / 搜索的转发，「复制密码 → 反馈」交互，以及
 * 列表页「最近更新」处展示的云端「上次同步时间」副信息（模块 2 §3 GET /backup/meta）。
 * 视图层只关心调用与展示，不直接接触剪贴板、store 取值与备份元信息拉取逻辑。
 */
export function useVault() {
  const store = useVaultStore()
  const cloudStore = useCloudAccountStore()
  const { filteredEntries, categories, activeCategory, keyword, hydrating } =
    storeToRefs(store)
  // 云端登录态与备份元信息缓存：用于在「最近更新」标题旁展示「上次同步」时间
  const { loggedIn: cloudLoggedIn, backupMeta } = storeToRefs(cloudStore)

  /**
   * 「上次同步」副信息文案（仅展示相对时间，不含体积 / 版本）。
   * 据 backupMeta 缓存（§3 GET /backup/meta 拉取结果）派生，仅以下情形有值，否则为空串（列表页不展示，保持清爽）：
   *   - 未登录 / 尚未拉取（backupMeta 为 null）→ ''
   *   - 云端暂无备份（hasBackup=false）→ ''
   *   - 命中且 updatedAt 可解析 → 「上次同步：<相对时间>」（如「上次同步：刚刚 / 3 分钟前」）
   */
  const lastSyncText = computed(() => {
    if (!cloudLoggedIn.value) return ''
    const meta = backupMeta.value
    if (!meta || !meta.hasBackup) return ''
    const rel = formatRelativeTime(meta.updatedAt)
    return rel ? `上次同步：${rel}` : ''
  })

  // 进入密码库页时按需拉取一次备份元信息（轻量：只取 updatedAt 等，不拉 blob / 不解密）。
  // 仅已登录时发起；离开页面取消在途请求。失败由 store.loadBackupMeta 内部静默吞掉（副信息不阻断列表）。
  let metaController = null
  onMounted(() => {
    if (!cloudLoggedIn.value) return
    metaController = new AbortController()
    cloudStore.loadBackupMeta({ signal: metaController.signal }).catch(() => {
      // AbortError（离开页面取消）等已在 store 层处理 / 此处兜底吞掉，不打扰用户
    })
  })
  onUnmounted(() => {
    metaController?.abort()
  })

  /** 复制指定条目的明文密码到剪贴板，并给出反馈 */
  async function copySecret(entry) {
    const secret = store.getSecret(entry.id)
    if (!secret) {
      toastInfo('暂无可复制的密码')
      return
    }
    try {
      await copyText(secret)
      // uni.showToast 仅支持纯文本，故用单行文案（源工程的图标 + 副提醒多行 VNode 在此不适用）；
      // 60s 自动清除剪贴板已由 clipboard 层兜底，无需在文案里再提醒。
      toastSuccess(`已复制「${entry.name}」的密码`)
    } catch {
      toastError('复制失败，请手动复制')
    }
  }

  return {
    // 响应式状态
    filteredEntries,
    categories,
    activeCategory,
    keyword,
    hydrating,
    // 列表页「最近更新」处的云端「上次同步」时间副信息（模块 2 §3，仅时间）
    lastSyncText,
    // 转发 action
    setCategory: store.setCategory,
    setKeyword: store.setKeyword,
    // 交互
    copySecret
  }
}
