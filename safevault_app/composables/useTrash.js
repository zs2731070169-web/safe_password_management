/**
 * useTrash —— 回收站交互编排
 *
 * 转发回收站读写到 vault store，并承接各类交互反馈：
 *   - 恢复：直接恢复到主库并提示成功（非破坏性，无需二次确认）；
 *   - 彻底删除单条 / 清空回收站：执行删除并提示成功（移动端二次确认由视图层的
 *     底部确认面板 ConfirmSheet 负责，本组合式函数只负责「确认通过后」的实际删除）；
 *   - 账号脱敏展示：复用全局规则，受 settings.maskAccount 开关控制；
 *   - 剩余可恢复天数：按 deletedAt + 保留窗口（TRASH_RETENTION_DAYS）派生，临期高亮。
 *
 * 视图只调用本组合式函数，不直接触碰 store（与 useSettings、usePasswordDetail 等保持一致）。
 * main.js 已引入 el-message 样式，可直接用 ElMessage 做轻提示（toast 适配移动端，不阻断）。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'

import { useVaultStore, TRASH_RETENTION_DAYS } from '@/stores/vault'
import { useSettingsStore } from '@/stores/settings'
import { maskAccountText } from '@/utils/maskAccount'

/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000

export function useTrash() {
  const vault = useVaultStore()
  const { trashedEntries } = storeToRefs(vault)
  const { maskAccount } = storeToRefs(useSettingsStore())

  /** 回收站是否为空（控制空态 / 清空入口显隐） */
  const isEmpty = computed(() => trashedEntries.value.length === 0)

  /**
   * 账号展示文案：开启「账号脱敏显示」时打码（与主库一致）。
   * @param {string} account 真实账号明文
   * @returns {string}
   */
  function displayAccount(account) {
    return maskAccount.value ? maskAccountText(account) : account ?? ''
  }

  /**
   * 剩余可恢复天数（向上取整，至少 1 天；超期返回 0）。
   * @param {number} deletedAt 删除时刻 ms 时间戳
   * @returns {number}
   */
  function remainingDays(deletedAt) {
    const elapsed = Date.now() - (deletedAt ?? 0)
    const left = Math.ceil(TRASH_RETENTION_DAYS - elapsed / DAY_MS)
    return Math.max(0, left)
  }

  /** 临期标记：剩余 ≤ 3 天时高亮提醒 */
  function isExpiring(deletedAt) {
    return remainingDays(deletedAt) <= 3
  }

  /**
   * 恢复条目到主库（非破坏性，直接执行）。
   * @param {object} entry 回收站条目
   */
  function restore(entry) {
    if (vault.restoreEntry(entry.id)) {
      toastSuccess(`已恢复「${entry.name}」`)
    }
  }

  /**
   * 彻底删除单条（不可恢复）。二次确认由视图的 ConfirmSheet 负责，此处只执行删除 + 提示。
   * @param {object} entry 回收站条目
   */
  function purge(entry) {
    if (vault.purgeEntry(entry.id)) {
      toastSuccess('已永久删除')
    }
  }

  /** 清空回收站（彻底删除全部，不可恢复）。二次确认由视图的 ConfirmSheet 负责。 */
  function empty() {
    if (isEmpty.value) return
    const count = vault.emptyTrash()
    if (count) toastSuccess(`已清空回收站（${count} 条）`)
  }

  return {
    // 状态
    trashedEntries,
    isEmpty,
    retentionDays: TRASH_RETENTION_DAYS,
    // 展示辅助
    displayAccount,
    remainingDays,
    isExpiring,
    // 方法
    restore,
    purge,
    empty
  }
}
