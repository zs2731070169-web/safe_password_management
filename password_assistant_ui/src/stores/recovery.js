import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 恢复码 Store
 *
 * 持有「当前生效的账户恢复码」，供：
 *   - 恢复码管理页（useRecoveryCode）重新生成后写入（新码即时生效、旧码失效）；
 *   - 找回访问权限页（useRecovery）验证用户输入是否与当前恢复码一致。
 *
 * 当前为纯前端 mock：明文持久化到 localStorage，默认沿用历史测试码
 * 12345-12345-12345-12345-12345（未重新生成过时仍可用）。
 * 真实接入时：恢复码应仅以哈希形式存于后端、本地绝不留明文，
 * 届时只替换本文件末尾的 mock 持久化与下方 verify/setRecoveryCode 内部实现即可，
 * 视图与 composable 不动。
 */

/** localStorage 持久化 key */
const STORAGE_KEY = 'safevault.recovery-code'
/** 默认恢复码（历史测试码，未重新生成前可用） */
const DEFAULT_CODE = '12345-12345-12345-12345-12345'

export const useRecoveryStore = defineStore('recovery', () => {
  /** 当前生效的恢复码（已格式化，含连字符） */
  const recoveryCode = ref(loadCode())

  /**
   * 设置为新的当前恢复码（重新生成后调用）。
   * @param {string} code 新恢复码（XXXXX-XXXXX-XXXXX-XXXXX-XXXXX）
   */
  function setRecoveryCode(code) {
    const formatted = String(code ?? '').trim()
    if (!normalize(formatted)) return // 空 / 非法忽略
    recoveryCode.value = formatted
    persist(formatted)
  }

  /**
   * 校验输入是否与当前恢复码一致（忽略大小写、连字符与空白）。
   * @param {string} input 用户输入
   * @returns {boolean}
   */
  function verify(input) {
    const clean = normalize(input)
    return Boolean(clean) && clean === normalize(recoveryCode.value)
  }

  return {
    recoveryCode,
    setRecoveryCode,
    verify
  }
})

// ===============================================================
// 以下为 mock / 本地持久化实现，真实接入时替换即可
// ===============================================================

/** 归一化为比对用形式：大写 + 仅保留字母数字（去连字符 / 空白） */
function normalize(code) {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** 读取持久化恢复码，缺省回落默认码 */
function loadCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_CODE
  } catch {
    return DEFAULT_CODE
  }
}

/** 写回 localStorage（隐私模式 / 配额异常时静默降级） */
function persist(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // 不可用时静默，不阻断交互
  }
}
