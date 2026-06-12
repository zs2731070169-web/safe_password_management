/**
 * 云端水合编排（登录后「下载优先」的会话初始化）—— 进入密码库即为云端真实数据
 *
 * vault store 的条目是会话内存态、不持久化，启动时为空。本组合式函数在应用持久根
 * （App.vue）激活一次，监听登录完成，自动把云端最新整库快照下载解密、覆盖本地，使登录后整库即云端最新。
 *
 * 「下载优先」语义（与登录后自动上传二选一，避免竞态）：
 *   - 只在 `settings.cloudBackup` 开启且已登录时执行（与自动上传门控对称）；
 *   - pullSnapshot（带 access、401 续签重试一次），据返回 status 分流：
 *       · ok           → vault.replaceFromSnapshot 覆盖本地库（含回收站）。**静默**，自动初始化不弹提示；
 *       · empty        → 云端暂无备份（首份场景）→ pushSnapshot 把本地推上云端做首份备份；
 *       · undecryptable→ 提示决策点 C1 文案「云备份不可解密，需重新上传」，不覆盖、不补传；
 *       · skipped      → 未登录（门控已挡，理论不达），静默。
 *   - 401（续签后仍失败）/ 网络等 → ElMessage 轻提示（本地数据仍可用，不阻塞）；AbortError 静默。
 *
 * 与 useCloudBackup 配套：登录后的会话初始化由本函数统一编排（下载优先，empty 才首份上传），
 * useCloudBackup 不再于登录时补传，二者不抢跑。
 *
 * ok 分支覆盖本地不会触发多余回传：replaceFromSnapshot 置「程序覆盖」标志，useCloudBackup 监听器
 * 据此跳过这一拍回写（与 useCloudRestore 一致），故下载覆盖只发 GET、不产生原样 PUT。
 */
import { watch } from 'vue'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'
import { useVaultStore } from '@/stores/vault'
import { useSettingsStore } from '@/stores/settings'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { pullSnapshot, pushSnapshot } from '@/services/cloudBackup'

/**
 * 在持久组件（App.vue）的 setup 中调用一次，激活登录后的云端水合监听。
 */
export function useCloudHydrate() {
  const vault = useVaultStore()
  const settings = useSettingsStore()
  const account = useCloudAccountStore()

  /** 当前在途请求的取消控制器（再次触发时取消上一次） */
  let controller = null

  /** 是否具备水合前置（开关开启 + 已登录） */
  const canHydrate = () => settings.cloudBackup && account.loggedIn

  /**
   * 执行一次云端水合：下载解密整库 → 覆盖本地；云端为空则把本地推上云端做首份。
   * 全程吞掉用户主动取消（AbortError），仅对真实错误给轻提示，本地数据始终可用。
   */
  async function hydrate() {
    if (!canHydrate()) return
    // 首行同步置真：确保登录跳转后 VaultView 首帧即读到加载态，避免云端数据到达前先露出空态。
    vault.hydrating = true
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    try {
      const res = await pullSnapshot({ signal })
      switch (res.status) {
        case 'ok':
          // 覆盖本地库（含回收站，保留 deletedAt）。静默：自动会话初始化非用户主动操作，不弹提示。
          vault.replaceFromSnapshot(res.snapshot)
          break
        case 'empty':
          // 云端暂无备份：把当前本地库推上云端做首份备份（内部 skipped/stale 自处理，静默）。
          await pushSnapshot({ signal })
          break
        case 'undecryptable':
          // 密码解不开云端 wrappedDataKey（多为重置密码后旧包裹）——标记待恢复，
          // 引导用户用恢复码取回 DataKey（recoverWithCode）。
          // 此时无可用 DataKey、解不出任何密文，库应为空：清掉本地会话内存态，
          // 避免在待恢复态下把上一会话已水合的数据误当作当前数据展示。
          account.pendingRecovery = true
          vault.clearAll()
          break
        case 'skipped':
          // 未登录（门控已挡，理论不达），静默。
          break
        default:
          break
      }
    } catch (err) {
      if (err?.name === 'AbortError') return // 被取消，静默
      toastError(err?.message || '云端同步失败，请稍后重试')
    } finally {
      vault.hydrating = false
    }
  }

  // 监听登录完成：loggedIn 启动恒为 false（会话态不持久化），重新登录才触发。
  // 非 immediate：避免应用启动 / store 初始化时空跑（仅真正登录那一刻触发一次）。
  watch(
    () => account.loggedIn,
    (now, was) => {
      if (now && !was) hydrate()
    }
  )
}
