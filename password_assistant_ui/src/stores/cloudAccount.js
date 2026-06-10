import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { maskAccountText } from '@/utils/maskAccount'
import { postJson } from '@/services/http'

/**
 * 云账户 / 认证状态 Store —— 应用的唯一身份中枢
 *
 * SafeVault 已统一为「云账户即身份」：去掉本地主密码概念，登录 / 解锁、修改密码、
 * 找回密码全部围绕云账户（邮箱 + 密码）。本 store 取代原 stores/auth.js，集中管理：
 *   - 账户绑定（邮箱 + 密码，持久化；mock 明文，真实接入改存 Argon2id 哈希）；
 *   - 会话态 loggedIn（本次是否已登录解锁，不持久化，启动须重新登录，保持安全体验）；
 *   - 注册 / 登录 / 改密 / 重置 / 续签 / 登出等动作。
 *
 * 路由守卫据 hasAccount（是否已注册）与 loggedIn（本次是否已登录）两闸放行。
 *
 * 当前为纯前端 mock：账户凭据持久化到 localStorage（明文，仅演示）；真实接入时仅替换
 * 文件末尾 mock 区（改调后端 /auth/* 与零知识密钥派生），对外 actions / getters 签名不变。
 *
 * 对应 SDD 接口：
 *   - sendVerifyCode → POST /auth/verify-code
 *   - register       → POST /auth/register
 *   - login          → POST /auth/login
 *   - refresh        → POST /auth/refresh
 */
export const useCloudAccountStore = defineStore('cloudAccount', () => {
  // ---------------------------------------------------------------
  // state（账户绑定从本地持久化恢复；会话态运行时维护）
  // ---------------------------------------------------------------
  const restored = loadCloudAccount()

  /** 已绑定的云账户邮箱（null 表示从未注册） */
  const email = ref(restored.email)
  /** 账户密码（mock 明文持久化；真实接入改为不在本地留可还原凭据） */
  const password = ref(restored.password)
  /** 本次会话是否已登录解锁（不持久化，启动恒为 false） */
  const loggedIn = ref(false)
  /** 验证码下发中（loading 态） */
  const sendingCode = ref(false)
  /** 注册 / 登录 / 重置进行中（loading 态） */
  const authenticating = ref(false)

  // ---------------------------------------------------------------
  // getters
  // ---------------------------------------------------------------
  /** 是否已注册云账户（存在绑定邮箱）。供路由守卫第①闸判断 */
  const hasAccount = computed(() => Boolean(email.value))
  /** 脱敏后的绑定邮箱（如 da***@icloud.com），未绑定为空串 */
  const maskedEmail = computed(() => (email.value ? maskAccountText(email.value) : ''))

  // ---------------------------------------------------------------
  // actions（对外签名稳定，真实接入仅替换文件末尾 mock 区）
  // ---------------------------------------------------------------
  /**
   * 下发邮箱验证码（注册 / 重置共用）。对应 POST /auth/verify-code。
   * @param {string} addr 目标邮箱
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>}
   */
  async function sendVerifyCode(addr, { signal } = {}) {
    if (sendingCode.value) return false
    sendingCode.value = true
    try {
      return await requestVerifyCode(addr, signal)
    } finally {
      sendingCode.value = false
    }
  }

  /**
   * 注册云账户：校验验证码通过后绑定邮箱 + 密码并登录。对应 POST /auth/register。
   * 新用户首次启动「创建云账户」时调用。
   * @param {{ email: string, password: string, code: string }} payload
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 注册成功返回 true
   */
  async function register({ email: addr, password: pwd, code }, { signal } = {}) {
    return runAuth(async () => {
      await mockRegister(addr, pwd, code, signal)
      email.value = addr
      password.value = pwd
      loggedIn.value = true
      persistCloudAccount({ email: addr, password: pwd })
    })
  }

  /**
   * 登录已有云账户：邮箱 + 密码换取访问 token。对应 POST /auth/login。
   * @param {{ email: string, password: string }} payload
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 登录成功返回 true
   */
  async function login({ email: addr, password: pwd }, { signal } = {}) {
    return runAuth(async () => {
      await mockLogin(addr, pwd, signal)
      loggedIn.value = true
    })
  }

  /**
   * 校验当前账户密码（不改变登录态）。
   * 用于敏感操作前的二次确认（如修改密码、删除条目）。对应原 verifyMasterPassword。
   * @param {string} pwd 待校验密码
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 是否校验通过
   */
  async function verifyPassword(pwd, { signal } = {}) {
    try {
      await mockVerifyPassword(pwd, signal)
      return true
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      return false
    }
  }

  /**
   * 修改账户密码（身份已在进入页时验证）。对应原 changeMasterPassword。
   * @param {string} newPassword 新密码
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 修改成功返回 true
   */
  async function changePassword(newPassword, { signal } = {}) {
    await mockChangePassword(newPassword, signal)
    password.value = newPassword
    persistCloudAccount({ email: email.value, password: newPassword })
    return true
  }

  /**
   * 邮箱验证码重置密码（忘记密码流程）。校验验证码通过后更新密码。
   * @param {{ code: string, newPassword: string }} payload
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 重置成功返回 true
   */
  async function resetPassword({ code, newPassword }, { signal } = {}) {
    return runAuth(async () => {
      await mockResetPassword(code, newPassword, signal)
      password.value = newPassword
      persistCloudAccount({ email: email.value, password: newPassword })
    })
  }

  /**
   * 续签 token（静默）。对应 POST /auth/refresh。
   * @returns {Promise<boolean>}
   */
  async function refresh() {
    if (!loggedIn.value) return false
    return mockRefresh()
  }

  /** 直接标记为已登录（身份已由其它方式确认：指纹登录 / 重置密码后） */
  function markLoggedIn() {
    loggedIn.value = true
  }

  /**
   * 锁定 / 登出：清本次会话登录态，保留账户绑定（邮箱 + 密码）。
   * 自动锁定与设置页「退出登录」共用——下次回登录页可用密码 / 指纹重新登录。
   */
  function lock() {
    loggedIn.value = false
  }
  /** logout 与 lock 同义（语义化别名，供「退出登录」调用） */
  const logout = lock

  // ---------------------------------------------------------------
  // 内部工具：统一封装注册 / 登录 / 重置的 loading 与异常透传
  // ---------------------------------------------------------------
  async function runAuth(task) {
    if (authenticating.value) return false
    authenticating.value = true
    try {
      await task()
      return true
    } finally {
      authenticating.value = false
    }
  }

  return {
    // state
    email,
    loggedIn,
    sendingCode,
    authenticating,
    // getters
    hasAccount,
    maskedEmail,
    // actions
    sendVerifyCode,
    register,
    login,
    verifyPassword,
    changePassword,
    resetPassword,
    refresh,
    markLoggedIn,
    lock,
    logout
  }
})

// ===============================================================
// 后端对接 / mock 混合区
// ===============================================================
//
// 说明：
//   - 【已真实接入】sendVerifyCode → POST /auth/verify-code（下发邮箱验证码，见 requestVerifyCode）。
//   - 【仍为 mock】register / login / resetPassword 等后端尚未提供，暂沿用本地模拟：
//     账户邮箱与密码持久化到 localStorage safevault.cloud（明文，仅演示！真实接入须改存
//     Argon2id 哈希 / refresh token，本地不留可还原凭据）。会话态 loggedIn 不持久化。
//   - ⚠️ 过渡期不一致：发码已走真实后端（邮箱收到的是随机 6 位真码），但 register / resetPassword
//     仍 mock 校验固定 123456。演示注册 / 重置请输入 123456；待 §2 register 接口接入后一并替换。

/** localStorage 持久化 key */
const CLOUD_KEY = 'safevault.cloud'
/** 演示用固定验证码（仅 register / resetPassword mock 校验用，发码已真实化） */
const DEMO_CODE = '123456'

/**
 * 下发验证码：对接后端 POST /auth/verify-code。
 * 后端成功返回 { sent: true }；冷却 / 限流 → 429、邮箱非法 → 422，均由 http 层抽取 detail 抛出。
 * @param {string} addr 目标邮箱
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>} 后端确认已下发返回 true
 */
function requestVerifyCode(addr, signal) {
  // 前置轻量校验：邮箱明显非法时直接给中文提示，避免无谓打后端（后端 422 的 msg 为英文）
  if (!addr || !addr.includes('@')) {
    return Promise.reject(new Error('请输入有效的邮箱地址'))
  }
  return postJson('/auth/verify-code', { email: addr }, { signal }).then((res) => Boolean(res?.sent))
}

/** 读取持久化的云账户绑定（缺省 / 解析失败回落未注册） */
function loadCloudAccount() {
  try {
    const raw = localStorage.getItem(CLOUD_KEY)
    if (!raw) return { email: null, password: null }
    const parsed = JSON.parse(raw)
    return {
      email: parsed.email ?? null,
      password: parsed.password ?? null
    }
  } catch {
    return { email: null, password: null }
  }
}

/** 写回云账户绑定（隐私模式 / 配额异常时静默降级，不阻断交互） */
function persistCloudAccount({ email, password }) {
  try {
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ email, password }))
  } catch {
    // 不可用时静默
  }
}

/** 模拟注册：校验验证码，真实接入替换为 POST /auth/register */
function mockRegister(addr, pwd, code, signal) {
  return delay(900, signal).then(() => {
    if (code !== DEMO_CODE) throw new Error('验证码不正确')
    return true
  })
}

/** 模拟登录：比对持久化的邮箱 + 密码，真实接入替换为 POST /auth/login */
function mockLogin(addr, pwd, signal) {
  return delay(800, signal).then(() => {
    const saved = loadCloudAccount()
    if (!saved.email || addr !== saved.email || pwd !== saved.password) {
      throw new Error('邮箱或密码不正确')
    }
  })
}

/** 模拟校验当前密码：比对持久化的密码 */
function mockVerifyPassword(pwd, signal) {
  return delay(700, signal).then(() => {
    const saved = loadCloudAccount()
    if (!saved.password || pwd !== saved.password) {
      throw new Error('密码不正确')
    }
  })
}

/** 模拟修改密码：真实接入替换为「用新密码重新包裹密钥」 */
function mockChangePassword(newPassword, signal) {
  return delay(900, signal).then(() => true)
}

/** 模拟重置密码：校验验证码后更新，真实接入替换为后端重置接口 */
function mockResetPassword(code, newPassword, signal) {
  return delay(900, signal).then(() => {
    if (code !== DEMO_CODE) throw new Error('验证码不正确')
    return true
  })
}

/** 模拟续签：真实接入替换为 POST /auth/refresh */
function mockRefresh() {
  return delay(400).then(() => true)
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
