/**
 * 云端备份删除编排（模块 2 DELETE /backup 的前端入口）
 *
 * 把「彻底删除云端备份」这条危险链路收敛成一个可被设置页调用的入口（与 useCloudRestore 对称）：
 *   - **方案 A：开关与删除解耦**——关闭云备份开关只本地停传、绝不到达这里；唯有用户在设置页
 *     **显式点「删除云端备份」并经底部面板 ConfirmSheet（danger）二次确认**后，才调本函数。
 *     故本函数只负责「确认通过后」的实际删除，**不自行弹确认框**（确认由视图 ConfirmSheet 负责）。
 *   - deleteBackup（带 access、401 续签重试一次、幂等）据返回 status 分流：
 *       · ok      → toastSuccess('已删除云端备份')（幂等：本无备份也算成功，同样提示）
 *       · skipped → 未登录（理论不达，删除入口在已登录设置页），提示需先登录
 *   - 401（续签后仍失败）/ 网络等 → ElMessage 轻提示；AbortError（被取消）静默。
 *
 * 与 useCloudRestore 一致的编排风格：deleting（防重复点击）+ ElMessage 反馈 + AbortController 取消。
 * 视图只调用本组合式函数，不直接碰 service / store。
 */
import { ref } from 'vue'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { deleteBackup } from '@/services/cloudBackup'

/**
 * @returns {{ deleting: import('vue').Ref<boolean>, deleteCloudBackup: () => Promise<void> }}
 */
export function useDeleteBackup() {
  const account = useCloudAccountStore()

  /** 删除进行中（防重复触发，可供视图禁用入口） */
  const deleting = ref(false)
  /** 当前在途请求的取消控制器（再次触发时取消上一次） */
  let controller = null

  /**
   * 执行删除云端备份（**调用前应已由视图 ConfirmSheet 完成二次确认**）。
   * 全程吞掉用户主动取消（AbortError），仅对真实错误给提示。
   */
  async function deleteCloudBackup() {
    // 未登录直接提示（删除入口在已登录设置页，正常不会命中，仅作兜底）
    if (!account.loggedIn) {
      toastInfo('请先登录后再删除云端备份')
      return
    }
    if (deleting.value) return

    deleting.value = true
    controller?.abort()
    controller = new AbortController()
    try {
      const res = await deleteBackup({ signal: controller.signal })
      switch (res.status) {
        case 'ok':
          // 幂等：删除成功 / 本无备份均视为成功，统一反馈（云端此刻确已无备份）
          toastSuccess('已删除云端备份')
          break
        case 'skipped':
          toastInfo('请先登录后再删除云端备份')
          break
        default:
          break
      }
    } catch (err) {
      if (err?.name === 'AbortError') return // 被取消，静默
      toastError(err?.message || '删除云端备份失败，请稍后重试')
    } finally {
      deleting.value = false
    }
  }

  return { deleting, deleteCloudBackup }
}
