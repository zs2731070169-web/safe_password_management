/**
 * useAddPassword —— 新增密码逻辑
 *
 * 封装新增密码的异步提交、加载态、反馈与「一键生成强密码」。
 * 遵循 useResetPassword.js 的模式：通过 AbortController 在组件卸载时取消进行中的请求。
 * 真实接入时仅替换 savePassword 内部的 mock 提交，视图不动。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useVaultStore } from '@/stores/vault'
import { useGeneratorStore } from '@/stores/generator'

/**
 * @returns {{
 *   saving: import('vue').Ref<boolean>,
 *   savePassword: (payload: object) => Promise<object | null>,
 *   updatePassword: (id: string, payload: object) => Promise<object | null>,
 *   generatePassword: () => string,
 *   cleanup: () => void
 * }}
 */
export function useAddPassword() {
  const vaultStore = useVaultStore()
  const generatorStore = useGeneratorStore()

  /** 保存 / 更新提交中标志 */
  const saving = ref(false)
  /** 请求取消控制器 */
  let abortController = null

  /**
   * 统一的「提交 + mock 延迟 + 反馈」编排：取消前次未完请求，1 秒延迟后执行 writer。
   * 新增与编辑共用，仅写库动作与文案不同。
   * @param {() => object} writer 真正的写库动作（返回条目）
   * @param {string} successText 成功提示文案
   * @returns {Promise<object | null>} 成功返回条目，失败 / 取消返回 null
   */
  async function submit(writer, successText) {
    if (saving.value) return null

    // 取消前一个未完成的请求
    if (abortController) abortController.abort()
    abortController = new AbortController()

    saving.value = true

    try {
      // TODO: 替换为真实 API 调用（加密入库 / 回写）
      // 模拟保存延迟（1 秒）
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000)
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })

      const entry = writer()
      ElMessage.success(successText)
      return entry
    } catch (err) {
      if (err.name === 'AbortError') return null
      ElMessage.error('保存失败，请稍后重试')
      return null
    } finally {
      saving.value = false
    }
  }

  /**
   * 提交新增密码
   * @param {{ name: string, account?: string, password: string, url?: string, category?: string, note?: string }} payload
   * @returns {Promise<object | null>} 成功返回新建条目，失败 / 取消返回 null
   */
  function savePassword(payload) {
    return submit(() => vaultStore.addEntry(payload), '记录保存成功')
  }

  /**
   * 提交编辑密码
   * @param {string} id 条目 id
   * @param {object} payload 表单字段
   * @returns {Promise<object | null>} 成功返回更新后条目，失败 / 取消返回 null
   */
  function updatePassword(id, payload) {
    return submit(() => vaultStore.updateEntry(id, payload), '记录更新成功')
  }

  /**
   * 一键生成强随机密码
   * 委托给生成器 store，使用用户在「生成」Tab 中保存的规则（长度 + 字符集开关），
   * 从而让保存的规则在新增 / 编辑页的「自动生成」中真正生效。
   * 用户从未调整过时，store 为默认规则（16 位、大小写 + 数字 + 符号）。
   * @returns {string} 生成的密码；规则无任何可用字符集时返回空串
   */
  function generatePassword() {
    return generatorStore.generate()
  }

  /** 清理：组件卸载时取消进行中的请求 */
  function cleanup() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    saving,
    savePassword,
    updatePassword,
    generatePassword,
    cleanup
  }
}
