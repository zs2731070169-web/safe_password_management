import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 认证 / 解锁状态 Store
 *
 * 主密码解锁为纯前端 mock（默认 123456）。生物识别（指纹）已抽到
 * services/biometric.js（真机系统指纹 / 浏览器 mock），由 useBiometricPrompt
 * 编排，验证通过后调用本 store 的 markUnlocked 置为已解锁。
 * 后续接入真实主密码能力时，仅需替换 actions 内部实现，组件无需改动。
 */
export const useAuthStore = defineStore('auth', () => {
  // ---------------------------------------------------------------
  // state
  // ---------------------------------------------------------------
  /** 是否已解锁 */
  const isUnlocked = ref(false)
  /** 解锁中（loading 态） */
  const unlocking = ref(false)
  /** 最近一次解锁失败信息，null 表示无错误 */
  const lastError = ref(null)

  // ---------------------------------------------------------------
  // getters
  // ---------------------------------------------------------------
  /** 是否处于可交互空闲态（未解锁且未在解锁中） */
  const canInteract = computed(() => !isUnlocked.value && !unlocking.value)

  // ---------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------
  /**
   * 主密码解锁（mock）
   * @param {string} password 主密码
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>}
   */
  async function unlockByMasterPassword(password, { signal } = {}) {
    return runUnlock(() => mockMasterPassword(password, signal))
  }

  /**
   * 校验主密码身份（不改变解锁状态）
   * 用于敏感操作前的二次确认，如删除条目。mock 默认主密码 123456。
   * @param {string} password 主密码
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 是否校验通过
   */
  async function verifyMasterPassword(password, { signal } = {}) {
    try {
      await mockMasterPassword(password, signal)
      return true
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      return false
    }
  }

  /**
   * 修改主密码（mock）
   * 设置页「修改主密码」专用：身份（旧凭证 / 指纹）已在进入页时由 IdentityVerifyModal
   * 验证，本动作仅负责将主密码更新为新值。
   * @param {string} newPassword 新主密码
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 修改成功返回 true
   */
  async function changeMasterPassword(newPassword, { signal } = {}) {
    return mockChangeMasterPassword(newPassword, signal)
  }

  /**
   * 直接标记为已解锁（无需再次校验）
   * 用于身份已通过其它方式确认的场景，如恢复码验证 + 重置主密码后进入。
   */
  function markUnlocked() {
    isUnlocked.value = true
    unlocking.value = false
    lastError.value = null
  }

  /** 锁定（登出），重置状态 */
  function lock() {
    isUnlocked.value = false
    unlocking.value = false
    lastError.value = null
  }

  // ---------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------
  /** 统一封装解锁流程的 loading / 错误处理 */
  async function runUnlock(task) {
    if (unlocking.value) return false
    unlocking.value = true
    lastError.value = null
    try {
      await task()
      isUnlocked.value = true
      return true
    } catch (err) {
      // 主动取消不视为错误
      if (err?.name === 'AbortError') return false
      lastError.value = err?.message || '解锁失败，请重试'
      return false
    } finally {
      unlocking.value = false
    }
  }

  return {
    // state
    isUnlocked,
    unlocking,
    lastError,
    // getters
    canInteract,
    // actions
    unlockByMasterPassword,
    verifyMasterPassword,
    changeMasterPassword,
    markUnlocked,
    lock
  }
})

// ===============================================================
// 以下为 mock 实现，真实接入时替换即可
// ===============================================================

/** 模拟主密码校验，默认主密码为 123456 */
function mockMasterPassword(password, signal) {
  return delay(800, signal).then(() => {
    if (password !== '123456') {
      throw new Error('主密码不正确')
    }
  })
}

/**
 * 模拟修改主密码：身份已在进入页时验证，此处仅模拟更新延迟后成功。
 * 真实接入时此处替换为后端「用新密码重新包裹密钥」调用，对外签名不变。
 */
function mockChangeMasterPassword(newPassword, signal) {
  return delay(900, signal).then(() => {
    // mock 不持久化新密码，仅模拟更新成功
    return true
  })
}

/** 可被 AbortSignal 中断的延时 Promise */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}
