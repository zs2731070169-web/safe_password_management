/**
 * useGenerator —— 密码生成器交互编排
 *
 * 转发生成规则（长度 / 字符集开关）的读写到 generator store。
 * 规则即时生效：拖动滑块 / 切换开关后立即写入 store，并防抖静默持久化（mock saveRule），
 * 无「保存规则」按钮、不弹成功提示，仅在保存失败或非法切换时给出 ElMessage。
 * 视图只调用本组合式函数，不直接触碰 store 的取消逻辑（与 useResetPassword 等保持一致）。
 */
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'

import { useGeneratorStore } from '@/stores/generator'

/** 自动保存防抖时长（ms）：连续切换合并为一次持久化 */
const PERSIST_DEBOUNCE = 300

/**
 * @returns {{
 *   length: import('vue').Ref<number>,
 *   options: import('vue').Ref<object>,
 *   minLength: number,
 *   maxLength: number,
 *   hasCharset: import('vue').ComputedRef<boolean>,
 *   setLength: (value: number) => void,
 *   toggleOption: (key: string) => void,
 *   cleanup: () => void
 * }}
 */
export function useGenerator() {
  const store = useGeneratorStore()
  const { length, options, hasCharset } = storeToRefs(store)

  /** 请求取消控制器（在途的自动保存） */
  let abortController = null
  /** 防抖计时器 */
  let debounceTimer = null

  /**
   * 防抖静默持久化当前规则（mock）。
   * 连续切换只触发一次保存；新一次保存会取消上一次在途请求。
   * 成功不打扰用户，失败给出提示。
   */
  function persist() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      debounceTimer = null
      if (abortController) abortController.abort()
      abortController = new AbortController()
      try {
        await store.saveRule(abortController.signal)
      } catch (err) {
        if (err.name === 'AbortError') return
        ElMessage.error('规则保存失败，请稍后重试')
      }
    }, PERSIST_DEBOUNCE)
  }

  /**
   * 设置密码长度（夹紧由 store 负责），随后自动持久化
   * @param {number} value 目标长度
   */
  function setLength(value) {
    store.setLength(value)
    persist()
  }

  /**
   * 切换字符集开关；关闭最后一个「包含」类时给出提示并阻止；切换成功后自动持久化
   * @param {string} key options 的键名
   */
  function toggleOption(key) {
    // 排除易混淆为附加项，可自由切换
    if (key === 'excludeAmbiguous') {
      store.toggleOption(key)
      persist()
      return
    }
    // 若当前为开且关掉后将无任何字符集，阻止并提示
    if (options.value[key] && !willHaveCharsetAfterOff(key)) {
      ElMessage.warning('至少需保留一种字符类型')
      return
    }
    store.toggleOption(key)
    persist()
  }

  /**
   * 校验：关闭 key 后是否仍有可用字符集
   * @param {string} key 即将关闭的开关键
   * @returns {boolean}
   */
  function willHaveCharsetAfterOff(key) {
    const include = ['uppercase', 'lowercase', 'numbers', 'symbols']
    return include.some((k) => k !== key && options.value[k])
  }

  /** 清理：组件卸载时取消待执行的防抖与在途请求 */
  function cleanup() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return {
    // 规则状态（来自 store）
    length,
    options,
    minLength: store.MIN_LENGTH,
    maxLength: store.MAX_LENGTH,
    hasCharset,
    // 方法
    setLength,
    toggleOption,
    cleanup
  }
}
