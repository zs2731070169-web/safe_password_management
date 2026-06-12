/**
 * 云端恢复编排（模块 2 GET /backup 的前端入口）
 *
 * 把「下载解密 → 覆盖本地库」这条链路收敛成一个可被设置页调用的入口：
 *   - 恢复会用云端快照**覆盖本地当前库**（含回收站），二次确认交由视图的移动端底部面板
 *     ConfirmSheet 负责（与退出登录 / 清空回收站同款原生交互）；本函数只负责「确认通过后」的
 *     实际下载与覆盖，**不再自行弹确认框**。
 *   - pullSnapshot（带 access、401 续签重试一次），据返回 status 分流：
 *       · ok           → 调 vault.replaceFromSnapshot 覆盖本地库 + toastSuccess('已从云端恢复')
 *       · empty        → 云端暂无备份（正常态，静默不提示）
 *       · undecryptable→ 提示决策点 C1 文案「云备份不可解密，需重新上传」
 *       · skipped      → 未登录（理论不达，恢复入口在已登录设置页），提示需先登录
 *   - 401（续签后仍失败）/ 网络等 → ElMessage 轻提示；AbortError（被取消）静默。
 *
 * 与 useCloudBackup 一致的编排风格：loading（防重复点击）+ ElMessage 反馈 + AbortController 取消。
 * 视图只调用本组合式函数，不直接碰 service / store。
 */
import { ref } from 'vue'
import { navTo, navReplace } from '@/utils/navigation'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'
import { useVaultStore } from '@/stores/vault'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { pullSnapshot } from '@/services/cloudBackup'

/**
 * @returns {{ restoring: import('vue').Ref<boolean>, restoreFromCloud: () => Promise<void> }}
 */
export function useCloudRestore() {
  const vault = useVaultStore()
  const account = useCloudAccountStore()

  /** 恢复进行中（防重复触发，可供视图禁用入口） */
  const restoring = ref(false)
  /** 当前在途请求的取消控制器（再次触发时取消上一次） */
  let controller = null

  /**
   * 执行从云端恢复（**调用前应已由视图 ConfirmSheet 完成二次确认**）：下载解密 → 覆盖本地库。
   * 全程吞掉用户主动取消（AbortError），仅对真实错误给提示。
   */
  async function restoreFromCloud() {
    // 未登录直接提示（恢复入口在已登录设置页，正常不会命中，仅作兜底）
    if (!account.loggedIn) {
      toastInfo('请先登录后再从云端同步')
      return
    }
    // 数据待恢复态：无 DataKey，云端 blob 用新密码也解不开（必得 undecryptable），直接引导去恢复 / 重建
    if (account.pendingRecovery) {
      toastInfo('数据待恢复，请先输入恢复码恢复或重建数据')
      navTo('RecoverData')
      return
    }
    if (restoring.value) return

    restoring.value = true
    controller?.abort()
    controller = new AbortController()
    try {
      const res = await pullSnapshot({ signal: controller.signal })
      switch (res.status) {
        case 'ok':
          // 覆盖本地库（含回收站，保留 deletedAt），对外签名稳定的真实 action
          vault.replaceFromSnapshot(res.snapshot)
          toastSuccess('已从云端同步')
          break
        case 'empty':
          // 云端暂无备份：属正常态，不打扰用户（按需求静默，不弹任何提示）
          break
        case 'undecryptable':
          // 决策点 C1：曾重置密码致旧 blob 不可解密 —— 引导用户重新上传覆盖
          toastInfo('云备份不可同步(由于重置过密码)，请重新备份')
          break
        case 'skipped':
          toastInfo('请先登录后再从云端同步')
          break
        default:
          break
      }
    } catch (err) {
      if (err?.name === 'AbortError') return // 被取消，静默
      toastError(err?.message || '云端恢复失败，请稍后重试')
    } finally {
      restoring.value = false
    }
  }

  return { restoring, restoreFromCloud }
}
