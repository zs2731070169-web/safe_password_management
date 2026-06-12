/**
 * useHealth —— 健康度页交互编排
 *
 * 封装「重新扫描」的加载态与反馈，以及「立即修改」入口跳转。
 * 遵循 useRecovery.js 的模式：通过 AbortController 在组件卸载时取消进行中的检测。
 * 业务状态读写均委托 health store，真实接入时只换 store 内部实现。
 */
import { ref } from 'vue'
import { navTo, navReplace } from '@/utils/navigation'
import { storeToRefs } from 'pinia'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'

import { useHealthStore } from '@/stores/health'

export function useHealth() {
  const store = useHealthStore()
  const {
    score,
    lastScan,
    keyword,
    problemCount,
    issues,
    filteredIssues,
    insight,
    scoreLevel,
    scoreLevelLabel
  } = storeToRefs(store)

  /** 重新检测中标志 */
  const rescanning = ref(false)
  /** 请求取消控制器 */
  let abortController = null

  /**
   * 重新扫描：触发本地检测并刷新分数 / 问题清单
   * @returns {Promise<boolean>} 成功返回 true
   */
  async function rescan() {
    if (rescanning.value) return false

    // 取消前一个未完成的检测
    if (abortController) {
      abortController.abort()
    }
    abortController = new AbortController()

    rescanning.value = true
    try {
      // TODO: 替换为真实本地扫描调用
      // 模拟检测耗时（1.2s）
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 1200)
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })

      const { count } = store.rescan()
      toastSuccess(`检测完成，发现 ${count} 个待处理项`)
      return true
    } catch (err) {
      if (err.name === 'AbortError') {
        // 检测被取消，不提示
        return false
      }
      toastError('检测失败，请稍后重试')
      return false
    } finally {
      rescanning.value = false
    }
  }

  /**
   * 立即修改：跳转到对应密码条目的编辑页（EditPassword，复用新增页编辑模式）。
   * 问题项的 target 与密码库真实条目 id 一致；安全建议（insight）无 target，
   * 不提供直接修改入口。保存后返回，健康分实时更新留待真实接入（DRD HLT-05）。
   * @param {object} problem 问题项
   */
  function fixProblem(problem) {
    const target = problem?.target
    if (!target) {
      toastInfo('该安全建议暂无可直接修改的条目')
      return
    }
    navTo('EditPassword', { id: target })
  }

  /**
   * 清理函数：组件卸载时取消进行中的检测
   */
  function cleanup() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    // 状态（来自 store）
    score,
    lastScan,
    keyword,
    problemCount,
    issues,
    filteredIssues,
    insight,
    scoreLevel,
    scoreLevelLabel,
    // 交互
    rescanning,
    rescan,
    fixProblem,
    cleanup
  }
}
