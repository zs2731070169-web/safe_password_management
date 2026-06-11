import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 密码生成器 Store
 *
 * 持有生成规则（密码长度 + 各字符集开关）与「保存规则」实现。
 * 当前为纯前端 mock：规则保存仅本地模拟、密码生成走本地随机；
 * 真实接入时仅替换文件末尾的 mock 实现（保存到后端 / 走更强的随机源），
 * 视图与 composable 不动。
 *
 * 还原 Figma「密码生成器」(node 1:831)：长度滑块 + 5 个字符集开关 + 保存规则按钮。
 *
 * 安全约束：生成全程本地完成，不上传任何明文。
 */
export const useGeneratorStore = defineStore('generator', () => {
  // ---------------------------------------------------------------
  // 常量：长度区间（与设计稿滑块一致）
  // ---------------------------------------------------------------
  /** 密码长度最小值 */
  const MIN_LENGTH = 8
  /** 密码长度最大值 */
  const MAX_LENGTH = 32

  // ---------------------------------------------------------------
  // state（生成规则）
  // ---------------------------------------------------------------
  /** 密码长度（默认 16，与设计稿一致） */
  const length = ref(16)
  /**
   * 字符集开关（默认：大小写 + 数字 + 符号开，排除易混淆关）
   *   uppercase  包含大写 (A-Z)
   *   lowercase  包含小写 (a-z)
   *   numbers    包含数字 (0-9)
   *   symbols    包含符号 (!@#)
   *   excludeAmbiguous 排除易混淆 (i, l, 1, L, o, 0, O)
   */
  const options = ref({
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false
  })

  // ---------------------------------------------------------------
  // getters
  // ---------------------------------------------------------------
  /**
   * 至少需勾选一个「包含」类字符集，否则无法生成（排除易混淆不计入）。
   * 视图据此禁用保存按钮、给出提示。
   */
  const hasCharset = computed(
    () =>
      options.value.uppercase ||
      options.value.lowercase ||
      options.value.numbers ||
      options.value.symbols
  )

  // ---------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------
  /**
   * 设置密码长度（自动夹紧到合法区间）
   * @param {number} value 目标长度
   */
  function setLength(value) {
    const n = Math.round(Number(value) || 0)
    length.value = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, n))
  }

  /**
   * 切换某个字符集开关
   * @param {string} key options 的键名
   */
  function toggleOption(key) {
    if (key in options.value) {
      options.value[key] = !options.value[key]
    }
  }

  /**
   * 按当前规则生成一条密码（mock，本地随机）
   * @returns {string} 生成的密码；无可用字符集时返回空串
   */
  function generate() {
    return mockGenerate(length.value, options.value)
  }

  /**
   * 保存生成规则（mock，模拟 1s 持久化）
   * 真实接入时此处改为写入后端 / 本地安全存储；返回当前快照供反馈。
   * @param {AbortSignal} [signal] 取消信号（组件卸载时中断）
   * @returns {Promise<{length:number, options:object}>} 已保存的规则快照
   */
  function saveRule(signal) {
    return mockSaveRule({ length: length.value, options: { ...options.value } }, signal)
  }

  return {
    // 常量
    MIN_LENGTH,
    MAX_LENGTH,
    // state
    length,
    options,
    // getters
    hasCharset,
    // actions
    setLength,
    toggleOption,
    generate,
    saveRule
  }
})

// ===============================================================
// 以下为 mock 实现，真实接入时替换即可
// ===============================================================

/** 各字符集字符池 */
const CHAR_POOL = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?'
}
/** 易混淆字符（排除易混淆开启时从字符池剔除） */
const AMBIGUOUS = new Set(['i', 'l', '1', 'L', 'o', '0', 'O'])

/**
 * 本地随机生成密码（mock）
 * 优先使用 crypto.getRandomValues 保证随机质量（新增 / 编辑页的「一键生成」也复用此函数）。
 * @param {number} length 长度
 * @param {object} options 字符集开关
 * @returns {string} 生成的密码
 */
function mockGenerate(length, options) {
  let pool = ''
  if (options.uppercase) pool += CHAR_POOL.uppercase
  if (options.lowercase) pool += CHAR_POOL.lowercase
  if (options.numbers) pool += CHAR_POOL.numbers
  if (options.symbols) pool += CHAR_POOL.symbols

  if (options.excludeAmbiguous) {
    pool = [...pool].filter((ch) => !AMBIGUOUS.has(ch)).join('')
  }
  if (!pool) return ''

  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += pool[secureRandomInt(pool.length)]
  }
  return result
}

/**
 * 生成 [0, max) 的随机整数，优先用 crypto，降级 Math.random
 * @param {number} max 上界（不含）
 * @returns {number}
 */
function secureRandomInt(max) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1)
    crypto.getRandomValues(arr)
    return arr[0] % max
  }
  return Math.floor(Math.random() * max)
}

/**
 * 模拟保存规则（延迟 1s，支持取消）
 * @param {object} snapshot 规则快照
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Promise<object>} 已保存的规则快照
 */
function mockSaveRule(snapshot, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'))
      return
    }
    const timer = setTimeout(() => resolve(snapshot), 1000)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('已取消', 'AbortError'))
    })
  })
}
