import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 认证 / 解锁状态 Store
 *
 * 主密码不再硬编码：新用户首次启动须经「开户流程」（views/onboarding）设置主密码，
 * 主密码与「是否已开户」标记一并持久化到 localStorage（当前为纯前端 mock，明文存储；
 * 真实接入时改为仅存 Argon2id 哈希、本地绝不留明文）。生物识别（指纹）已抽到
 * services/biometric.js（真机系统指纹 / 浏览器 mock），由 useBiometricPrompt
 * 编排，验证通过后调用本 store 的 markUnlocked 置为已解锁。
 * 后续接入真实主密码能力时，仅需替换文件末尾的 mock 实现，组件 / 路由守卫无需改动。
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
  /**
   * 是否已开户（已设置过主密码）。从本地持久化恢复，供路由守卫同步判断：
   * 未开户一律拦至开户页，保证「主密码必设且早于任何指纹录入」。
   */
  const hasMasterPassword = ref(loadHasAccount())

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
   * 开户：首次设置主密码（mock 持久化）。
   * 由开户流程步骤 1 调用，写入主密码并标记已开户。不在此处置为已解锁——
   * 解锁统一在开户末步（恢复码保存完成）由 markUnlocked 触发。
   * @param {string} password 用户设置的主密码
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 开户成功返回 true
   */
  async function setupMasterPassword(password, { signal } = {}) {
    const ok = await mockSetupMasterPassword(password, signal)
    if (ok) hasMasterPassword.value = true
    return ok
  }

  /**
   * 校验主密码身份（不改变解锁状态）
   * 用于敏感操作前的二次确认，如删除条目。比对开户时持久化的主密码。
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
    hasMasterPassword,
    // getters
    canInteract,
    // actions
    setupMasterPassword,
    unlockByMasterPassword,
    verifyMasterPassword,
    changeMasterPassword,
    markUnlocked,
    lock
  }
})

// ===============================================================
// 以下为 mock / 本地持久化实现，真实接入时替换即可
// ===============================================================
//
// 说明：主密码与「是否已开户」标记均持久化到 localStorage。
//   - safevault.account：'1' 表示已开户（已设置过主密码）；
//   - safevault.master ：主密码明文（仅 mock！真实接入须改为 Argon2id 哈希，本地绝不留明文）。
// 改为持久化后，开户设置的主密码、修改后的主密码下次启动均生效。

/** localStorage 持久化 key */
const ACCOUNT_KEY = 'safevault.account'
const MASTER_KEY = 'safevault.master'

/** 读取「是否已开户」标记（store 初始化时同步调用，供路由守卫判断） */
function loadHasAccount() {
  try {
    return localStorage.getItem(ACCOUNT_KEY) === '1'
  } catch {
    return false
  }
}

/** 读取持久化的主密码（未开户时为 null） */
function loadMasterPassword() {
  try {
    return localStorage.getItem(MASTER_KEY)
  } catch {
    return null
  }
}

/** 写入主密码 + 开户标记（隐私模式 / 配额异常时静默降级，不阻断交互） */
function persistMasterPassword(password) {
  try {
    localStorage.setItem(MASTER_KEY, password)
    localStorage.setItem(ACCOUNT_KEY, '1')
  } catch {
    // 不可用时静默
  }
}

/** 模拟主密码校验：比对开户时持久化的主密码（未开户必然失败） */
function mockMasterPassword(password, signal) {
  return delay(800, signal).then(() => {
    const saved = loadMasterPassword()
    if (!saved || password !== saved) {
      throw new Error('主密码不正确')
    }
  })
}

/**
 * 模拟开户：设置并持久化主密码。
 * 真实接入时此处替换为后端「用主密码派生密钥并初始化保险库」调用，对外签名不变。
 */
function mockSetupMasterPassword(password, signal) {
  return delay(800, signal).then(() => {
    persistMasterPassword(password)
    return true
  })
}

/**
 * 模拟修改主密码：身份已在进入页时验证，此处持久化新主密码后成功。
 * 真实接入时此处替换为后端「用新密码重新包裹密钥」调用，对外签名不变。
 */
function mockChangeMasterPassword(newPassword, signal) {
  return delay(900, signal).then(() => {
    persistMasterPassword(newPassword)
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
