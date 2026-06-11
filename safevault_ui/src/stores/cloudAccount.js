import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { maskAccountText } from '@/utils/maskAccount'
import { postJson } from '@/services/http'
import { deriveVerifier, deriveVerifierWithParams } from '@/utils/kdf'
import {
  generateBackupKdfParams,
  generateDataKeyRaw,
  importDataKey,
  deriveKek,
  wrapDataKey,
  unwrapDataKeyRaw,
  generateRecoveryCode,
  normalizeRecoveryCode
} from '@/services/crypto'
import { clearBackupCache, fetchBackupMeta } from '@/services/cloudBackup'
import { clearLocalVault, clearLocalVaultCache } from '@/services/localVault'
import { useSettingsStore } from '@/stores/settings'
import {
  saveSecureCredential,
  loadSecureCredential,
  clearSecureCredential,
  hasSecureCredential
} from '@/services/secureCredential'

/**
 * 云账户 / 认证状态 Store —— 应用的唯一身份中枢
 *
 * SafeVault 已统一为「云账户即身份」：去掉本地主密码概念，登录 / 解锁、修改密码、
 * 找回密码全部围绕云账户（邮箱 + 密码）。本 store 取代原 stores/auth.js，集中管理：
 *   - 账户绑定（邮箱 + 非机密的密文包裹 pwWrapped/pwKdf，持久化；**明文密码绝不落盘**）；
 *   - 会话态 loggedIn（本次是否已登录解锁，不持久化，启动须重新登录，保持安全体验）；
 *   - 注册 / 登录 / 改密 / 重置 / 续签 / 登出等动作。
 *
 * 路由守卫据 hasAccount（是否已注册）与 loggedIn（本次是否已登录）两闸放行。
 *
 * 认证链路（注册 / 登录 / 改密 / 重置 / 续签 / 登出）均已真实接入后端 /auth/*，走零知识密钥派生，
 * 明文密码只在会话内存留存、绝不出端也不落盘。本地仅持久化非机密的账户绑定与密文包裹。
 *
 * 对应 SDD 接口：
 *   - sendVerifyCode → POST /auth/verify-code
 *   - register       → POST /auth/register
 *   - login          → POST /auth/login
 *   - refresh        → POST /auth/refresh
 *   - changePassword → POST /auth/change-password（§5，已真实接入）
 *   - resetPassword  → POST /auth/reset-password（§6，已真实接入）+ 随即 POST /auth/login（§3）
 *   - logout         → POST /auth/logout（§7，已真实接入，本地优先兜底）
 */
export const useCloudAccountStore = defineStore('cloudAccount', () => {
  // ---------------------------------------------------------------
  // state（账户绑定从本地持久化恢复；会话态运行时维护）
  // ---------------------------------------------------------------
  const restored = loadCloudAccount()

  /** 已绑定的云账户邮箱（null 表示从未注册） */
  const email = ref(restored.email)
  /**
   * 账户明文密码——**仅本次会话内存留存，绝不持久化**（登录 / 注册 / 重置时由用户输入落入，
   * 启动 / 锁定 / 登出后即丢失）。它是零知识加密的会话密钥：用它派生 KEK 解开 pwWrapped 包裹的
   * 整库 DataKey、改密时派生 old_verifier。本地不再存任何可还原的明文凭据。
   */
  const password = ref(null)

  // ---- 包裹式密钥（envelope encryption）相关状态 ----
  /**
   * 「密码包裹的 DataKey」及其 KDF 配方（持久化，非机密——是密文 + 盐）。
   * 登录时优先用它 + 内存密码解包出会话 DataKey（同机重登 / 改密后均走本地，无需等云端）。
   * 改密时用新密码重算并覆盖；重置（忘密码）时旧 pwWrapped 作废、清空 → 触发恢复码恢复。
   */
  const pwWrapped = ref(restored.pwWrapped)
  const pwKdf = ref(restored.pwKdf)
  /**
   * 会话内的整库 DataKey 原始字节（32B，随机生成、独立于密码）。仅内存，lock/logout 清空。
   * 刻意用普通变量而非 ref：避免明文密钥进入 Vue 响应式系统 / devtools 暴露。
   * @type {Uint8Array | null}
   */
  let _dataKeyRaw = null
  /** 由 _dataKeyRaw 导入的 AES-GCM CryptoKey 缓存（供整库加解密），随 _dataKeyRaw 变化重建。 */
  let _dataKeyCrypto = null
  /**
   * 待恢复标志（**持久化**，跨刷新/重登稳定）：重置密码后旧 DataKey 包裹已作废，需用恢复码取回
   * DataKey、或显式「放弃旧数据并重建」(rebuildVault)。登录后由 UI / 水合检测此标志（或解包失败）
   * 引导进入恢复 / 重建流程；设置页据此常驻「数据待恢复」入口，避免跳过后再也回不去的死状态。
   */
  const pendingRecovery = ref(restored.pendingRecovery)
  /**
   * 注册时一次性产生、待展示给用户的恢复码（明文，仅本次会话内存，展示并确认后即清）。
   * 仅开户流程读取展示；其余时刻为空串。
   */
  const pendingRecoveryCode = ref('')
  /** 账户 id（即后端 userId，注册成功后由后端返回；过渡期仅内存留存） */
  const userId = ref(restored.userId)
  /**
   * 密钥派生配方（注册时产生：algorithm/salt/iterations/length）。持久化在本端，
   * 供 §3 登录用同一份配方重算出与注册一致的 verifier（非机密，仅盐 + 参数）。
   */
  const kdfParams = ref(restored.kdfParams)
  /** 访问令牌 accessToken（短时效，仅内存留存，不持久化） */
  const accessToken = ref(null)
  /** 刷新令牌 refreshToken（长时效，持久化以便后续续签；真实续签见 §4） */
  const refreshToken = ref(restored.refreshToken)
  /** 本次会话是否已登录解锁（不持久化，启动恒为 false） */
  const loggedIn = ref(false)
  /**
   * 安全区是否存有指纹登录凭据（即「能否指纹登录」）。从安全区同步读出，
   * 随开启 / 关闭指纹、退出 / 改密 / 重置而变化，供登录页指纹入口显隐判断。
   */
  const hasBiometricCredential = ref(hasSecureCredential())
  /** 验证码下发中（loading 态） */
  const sendingCode = ref(false)
  /** 注册 / 登录 / 重置进行中（loading 态） */
  const authenticating = ref(false)
  /**
   * 云端备份元信息缓存（模块 2 §3 GET /backup/meta），供设置页云账户卡片展示「上次备份」。
   * 仅内存缓存、不持久化：进入设置页按需拉取一次；登出 / 锁定时清空（旧账户元信息不应残留）。
   * 形态：
   *   - null：尚未拉取（卡片不展示「上次备份」副信息）
   *   - { hasBackup: false }：云端暂无备份（卡片展示「尚未备份」）
   *   - { hasBackup: true, version, size, updatedAt }：命中（卡片展示「上次备份：刚刚 · 12 KB · v8」）
   * @type {import('vue').Ref<null | { hasBackup: boolean, version?: number, size?: number, updatedAt?: string }>}
   */
  const backupMeta = ref(null)
  /** 备份元信息拉取中（loading 态，供卡片显占位） */
  const loadingBackupMeta = ref(false)

  // ---------------------------------------------------------------
  // getters
  // ---------------------------------------------------------------
  /** 是否已注册云账户（存在绑定邮箱）。供路由守卫第①闸判断 */
  const hasAccount = computed(() => Boolean(email.value))
  /** 脱敏后的绑定邮箱（如 da***@icloud.com），未绑定为空串 */
  const maskedEmail = computed(() => (email.value ? maskAccountText(email.value) : ''))

  // ---------------------------------------------------------------
  // actions（对外签名稳定）
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
      // 【已真实接入】零知识派生 verifier + kdf_params 后调 POST /auth/register，注册即登录。
      const { tokens, userId: uid, kdfParams: params } = await realRegister(addr, pwd, code, signal)
      // 保存会话凭据：access 仅内存、refresh 持久化以备续签；userId 记内存。
      accessToken.value = tokens?.accessToken ?? null
      refreshToken.value = tokens?.refreshToken ?? null
      userId.value = uid ?? null
      kdfParams.value = params
      email.value = addr
      password.value = pwd

      // —— 包裹式密钥：随机 DataKey + 密码/恢复码各包裹一份（零知识，明文不出端）——
      const dataKeyRaw = generateDataKeyRaw() // 真正加密整库的随机密钥，独立于密码
      setSessionDataKey(dataKeyRaw)
      const recoveryCode = generateRecoveryCode()
      pendingRecoveryCode.value = recoveryCode // 供开户流程展示给用户保存
      const newPwKdf = generateBackupKdfParams()
      pwWrapped.value = await wrapDataKey(await deriveKek(pwd, newPwKdf), dataKeyRaw)
      pwKdf.value = newPwKdf
      const rcKdf = generateBackupKdfParams()
      const rcWrapped = await wrapDataKey(
        await deriveKek(normalizeRecoveryCode(recoveryCode), rcKdf),
        dataKeyRaw
      )

      loggedIn.value = true
      // 持久化：含 pwWrapped/pwKdf（供下次同机重登离线解包）；kdfParams 供 §3 登录重算 verifier。
      // 明文密码不落盘——仅 password.value 会话内存留存。
      persistCloudAccount({
        email: addr,
        userId: uid,
        refreshToken: refreshToken.value,
        kdfParams: params,
        pwWrapped: pwWrapped.value,
        pwKdf: pwKdf.value
      })
      // 账户初始化基线（无视云备份开关）：上传首份整库 backup（带密码包裹的 DataKey）+ 恢复码包裹的
      // recovery-blob，使「恢复码恢复」自始可用。失败不阻断注册（本地已持有 DataKey，可后续重传）。
      const { pushSnapshot, pushRecoveryBlob } = await import('@/services/cloudBackup')
      await pushSnapshot({ signal }).catch(() => {})
      await pushRecoveryBlob({ wrappedDataKey: rcWrapped, kdfParams: rcKdf, signal }).catch(() => {})
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
      // 【已真实接入】先拉 kdf_params 再本地重算 verifier，POST /auth/login（§3，详见 realLogin）。
      const { tokens, userId: uid, kdfParams: params } = await realLogin(addr, pwd, signal)
      // 保存会话凭据：access 仅内存、refresh 持久化以备续签；userId 记内存。
      accessToken.value = tokens?.accessToken ?? null
      refreshToken.value = tokens?.refreshToken ?? null
      userId.value = uid ?? null
      kdfParams.value = params // 回填本地（如老账户此前无本地配方）
      email.value = addr
      password.value = pwd
      // 先尝试用本地 pwWrapped + 该密码解包会话 DataKey（同机重登 / 改密后重登走本地、离线即可），
      // **再**置登录态触发登录后初始化（useCloudHydrate / useLocalPersist），确保它们运行时 DataKey 已就绪、
      // 避免竞态。本地无包裹（换机 / 重置后已清）则解包失败，留待 useCloudHydrate 用云端 wrappedDataKey 解包。
      await unlockDataKeyFromLocal()
      loggedIn.value = true
      // 续期本地持久化：刷新 refreshToken / userId / kdfParams + 保留 pwWrapped/pwKdf；明文密码不落盘。
      // 保留待恢复标志：重置后跳过、再重登的场景，登录不应抹掉「数据待恢复」状态。
      persistCloudAccount({
        email: addr,
        userId: uid,
        refreshToken: refreshToken.value,
        kdfParams: params,
        pwWrapped: pwWrapped.value,
        pwKdf: pwKdf.value,
        pendingRecovery: pendingRecovery.value
      })
    })
  }

  /**
   * 校验当前账户密码（不改变登录态）。
   * 用于敏感操作前的二次确认（如修改密码、删除条目）。对应原 verifyMasterPassword。
   *
   * 零知识本地校验：不在本地留存任何明文密码，也无需后端——用待验密码 + 本地持有的 pwKdf
   * 派生 KEK，尝试解开 pwWrapped 包裹的 DataKey；AES-GCM 解包成功即证明密码正确，失败（密码不符）
   * 则验证标签校验不过抛错。无包裹（未登录 / 重置后待恢复）则无从校验，按未通过处理（fail closed）。
   * @param {string} pwd 待校验密码
   * @param {object} [_options]
   * @param {AbortSignal} [_options.signal] 本地派生为同步快路径，签名保留以兼容调用方
   * @returns {Promise<boolean>} 是否校验通过
   */
  async function verifyPassword(pwd /* , { signal } = {} */) {
    if (!pwd || !pwWrapped.value || !pwKdf.value) return false
    try {
      const kek = await deriveKek(pwd, pwKdf.value)
      await unwrapDataKeyRaw(kek, pwWrapped.value)
      return true
    } catch {
      // AES-GCM 验证失败 = 密码不正确（或包裹损坏），按未通过处理
      return false
    }
  }

  /**
   * 修改账户密码（身份已在进入页时验证）。对应 POST /auth/change-password（§5，方案 B 严格立即失效）。
   *
   * 零知识两段派生：
   *   - **旧密码** + 本地持有的旧 kdf_params → old_verifier，供后端二次核验「确实掌握旧密码」；
   *   - **新密码** → 新的 { verifier, kdfParams }（新 client salt，明文不出端）落库。
   * 带 access token 上送（首发 401 则静默续签后重试一次）。方案 B 下后端校验旧密码 → 重算落库 →
   * 自增 token_version + 清全部 refresh（**含当前设备在内的全部会话一并失效**），返回
   * { success, relogin }，**不再下发 token**。
   *
   * 改密成功后**强制重新登录**（与时序图 §5「改密成功须重新登录」、后端 relogin 语义一致）：
   * 本 action **不再静默续登**，而是清空本次会话凭据（loggedIn / access / refresh），保留账户绑定，
   * 由视图层导回登录页（/unlock），用户须用**新密码**重新登录。这避免给「刚被吊销的会话」开后门，
   * 也让用户明确感知密码已变更。
   *
   * @param {string} newPassword 新密码
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 修改成功返回 true
   */
  async function changePassword(newPassword, { signal } = {}) {
    // 旧密码核验所需：用**旧明文密码 + 旧 kdf_params** 在本地派生 old_verifier（方案 B 后端二次核验）。
    // password / kdfParams 为进入本页前已持久化的当前账户凭据；缺任一无法核验，按登录态失效处理。
    const oldPassword = password.value
    const oldKdfParams = kdfParams.value
    if (!oldPassword || !oldKdfParams) {
      const err = new Error('登录态已失效，请重新登录')
      err.status = 401
      throw err
    }

    // 1) 调后端改密：本地派生 old_verifier + 新 verifier/kdf_params 上送（带 401→续签→重试一次）。
    //    成功即代表后端已校验旧密码并完成落库 + 全量会话失效；方案 B 不返回 token，故此处不读返回。
    await realChangePassword({
      newPassword,
      oldPassword,
      oldKdfParams,
      accessToken: accessToken.value,
      // 续签回调：复用底层 realRefresh（不走 refresh() action，避免其 lock() 登出副作用），
      // 成功后立刻把新 refresh 落到 store，并返回新 access 供改密重试。
      renewAccess: async () => {
        if (!refreshToken.value) return null
        const { tokens: renewed } = await realRefresh(refreshToken.value, signal)
        accessToken.value = renewed?.accessToken ?? null
        refreshToken.value = renewed?.refreshToken ?? null
        return accessToken.value
      },
      signal
    })

    // 2) 方案 B：改密后含当前设备在内的全部会话已立即失效——**清空本次会话凭据，强制重新登录**。
    //    清 loggedIn / access / refresh（含持久化清空 refreshToken），路由守卫据此把用户拦回登录页。
    //    保留 email / userId 账户绑定，供登录页直接用新密码重登。
    loggedIn.value = false
    accessToken.value = null
    refreshToken.value = null
    // 会话内存中的明文密码同步为新密码（供本会话 KEK 派生 / 身份二次校验；不落盘）。
    password.value = newPassword
    // kdfParams 已被后端换为新 salt，本地旧配方作废 → 清空；下次登录由 realLogin 重新向后端拉取最新配方。
    kdfParams.value = null
    // 包裹式：DataKey 不变，仅用新密码重新包裹一份 pwWrapped 持久化（重登时本地即可解包）。
    // 整库密文无需重新加密、云端整库不必重传——改密因此瞬时完成；下次库变更自动把云端 wrappedDataKey 收敛为新的。
    if (_dataKeyRaw) {
      const newPwKdf = generateBackupKdfParams()
      pwWrapped.value = await wrapDataKey(await deriveKek(newPassword, newPwKdf), _dataKeyRaw)
      pwKdf.value = newPwKdf
    }
    persistCloudAccount({
      email: email.value,
      userId: userId.value,
      refreshToken: null,
      kdfParams: null,
      pwWrapped: pwWrapped.value,
      pwKdf: pwKdf.value
    })
    // 会话密钥随登出清空（重登用新 pwWrapped 解包重建）；本地 blob 用同一 DataKey 加密、仍有效，**不清**。
    clearSessionDataKey()
    // 安全区里存的是**旧**主密码，已随改密失效——清除并关闭指纹登录，避免指纹用旧密码登录失败。
    // 用户重新登录后可在设置页重新开启指纹（届时存入新密码）。
    clearBiometricCredential()
    return true
  }

  /**
   * 邮箱验证码重置密码（忘记密码流程）。对应 POST /auth/reset-password（§6）+ 随即 POST /auth/login（§3）。
   *
   * 【已真实接入 §6】链路设计（reset 不发 token → 随即 §3 login 拿新会话）：
   *   时序图 §6 明确「重置不自动登录 → 回登录页重新登录」：后端重置时**吊销该用户全部 refresh
   *   且不签发 token**（与「全量吊销」语义自洽）。但产品上现有 ResetPasswordView 在重置成功后直接
   *   进库，为同时尊重零知识语义又保留顺滑体验，这里在 reset 接口成功后**紧接着用新密码走一次真实
   *   §3 登录**——这才是重置后拿到合法会话的正当方式（而非伪造登录态）。于是视图层的 markLoggedIn()
   *   + 跳 Vault 保持不变（幂等）。
   *
   * 【避免 runAuth 自锁】runAuth 有 `if (authenticating.value) return false` 守卫；若此处在 runAuth
   *   内再调外层 login（login 也走 runAuth）会被守卫挡掉而死锁。故内部直接调底层裸函数
   *   realReset + realLogin（二者均不走 runAuth），由本 action 一次性占用 runAuth 并自行回写状态。
   *
   * @param {{ code: string, newPassword: string }} payload
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 重置并登录成功返回 true
   */
  async function resetPassword({ code, newPassword }, { signal } = {}) {
    return runAuth(async () => {
      const addr = email.value
      // §6：本地零知识派生新 verifier + 新 kdf_params 后 POST /auth/reset-password。后端更新
      // verifier/server_salt/kdf_params、DEL code、吊销全部 refresh，返回 { resetOk,
      // cloudBackupCleared }（C1：旧云备份失效，不发 token、不自动登录）。
      await realReset(addr, newPassword, code, signal)
      // §3：随即用新密码走一次真实登录拿合法会话——realLogin 会重新拉后端 kdf_params（此刻已是
      // 重置后的新 salt）、本地重算 verifier、比中后签发新 token。这是重置后拿会话的正当途径。
      const { tokens, userId: uid, kdfParams: params } = await realLogin(addr, newPassword, signal)
      // 回写会话凭据与账户绑定：access 仅内存、refresh 持久化；kdfParams 换了新 salt，**必须**更新
      // 并持久化新的（否则后续登录用旧 salt 重算 verifier 会比不中）。
      accessToken.value = tokens?.accessToken ?? null
      refreshToken.value = tokens?.refreshToken ?? null
      userId.value = uid ?? null
      kdfParams.value = params
      password.value = newPassword
      loggedIn.value = true
      // 重置（忘密码，决策点 C2）：旧密码包裹的 pwWrapped 无法用新密码解开 → 清空本地包裹、清会话密钥，
      // 标记 pendingRecovery；登录后由 UI 引导「输入恢复码恢复数据」(recoverWithCode) 取回 DataKey。
      pwWrapped.value = null
      pwKdf.value = null
      clearSessionDataKey()
      pendingRecovery.value = true
      persistCloudAccount({
        email: addr,
        userId: uid,
        refreshToken: refreshToken.value,
        kdfParams: params,
        pwWrapped: null,
        pwKdf: null,
        // 持久化待恢复标志：跳过恢复后刷新/重登仍能在设置页看到「数据待恢复」入口
        pendingRecovery: true
      })
      // 本地 blob 用旧会话 DataKey 加密，重置后会话密钥已清、暂不可解 → 清除，走云端 + 恢复码恢复。
      clearLocalVault()
      // 安全区里存的是**旧**主密码，已随重置失效——清除并关闭指纹登录（用户可重新登录后于设置页重开）。
      clearBiometricCredential()
    })
  }

  /**
   * 续签 token（静默轮转）。对应 POST /auth/refresh（§4）。
   *
   * 轮转语义：后端校验旧 refresh 后作废它并签发新对（新 access + 新 refresh）。
   * 成功则回写两个新 token 并把**新 refreshToken**重新持久化（旧的已在服务端失效）。
   * 失败：
   *   - 401（refresh 失效 / 被吊销 / 已轮转）→ lock() 清登录态 + 清 accessToken，
   *     返回 false 让路由守卫把用户导回登录页（§3 重新登录）；
   *   - AbortError → 原样 throw（交由上层取消逻辑处理）；
   *   - 其它错误（网络等）→ 返回 false，不动登录态（可由调用方稍后重试）。
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 续签成功返回 true
   */
  async function refresh({ signal } = {}) {
    // 未登录或无 refresh token：无可续签对象，直接返回 false
    if (!loggedIn.value || !refreshToken.value) return false
    try {
      const { tokens } = await realRefresh(refreshToken.value, signal)
      // 轮转回写：新 access（仅内存）+ 新 refresh（旧的已被后端 SREM 作废）
      accessToken.value = tokens?.accessToken ?? null
      refreshToken.value = tokens?.refreshToken ?? null
      // 持久化新的 refreshToken；email/userId/kdfParams 维持原值（从当前 ref 读）；明文密码不落盘
      // 保留待恢复标志：续签发生在待恢复窗口内时不应抹掉该状态
      persistCloudAccount({
        email: email.value,
        userId: userId.value,
        refreshToken: refreshToken.value,
        kdfParams: kdfParams.value,
        pendingRecovery: pendingRecovery.value
      })
      return true
    } catch (err) {
      // 取消信号原样上抛，不当作续签失败
      if (err?.name === 'AbortError') throw err
      // 401：refresh 已失效 / 被吊销 / 已轮转 → 强制登出，导回登录页
      if (err?.status === 401) {
        lock()
        accessToken.value = null
      }
      // 其它错误（网络等）保持登录态，仅本次续签失败
      return false
    }
  }

  /** 直接标记为已登录（身份已由其它方式确认：重置密码后随即真实登录） */
  function markLoggedIn() {
    loggedIn.value = true
  }

  /**
   * 拉取云端备份元信息（模块 2 §3 GET /backup/meta），写入 backupMeta 缓存供卡片展示「上次备份」。
   *
   * 轻量探测：底层 fetchBackupMeta 只取 version / size / updatedAt（不拉 blob、不解密），成本极低，
   * 适合进入设置页时按需调用。据 fetchBackupMeta 返回的 status 分流写入缓存：
   *   - ok    → { hasBackup: true, version, size, updatedAt }
   *   - empty → { hasBackup: false }（云端暂无备份，正常态，非错误）
   *   - skipped → 未登录 / 无 access：不改缓存（卡片本就不展示「上次备份」）
   * 失败（401 续签后仍失败 / 网络等）静默吞掉、不抛、不改缓存——「上次备份」是锦上添花的副信息，
   * 拉取失败不应打扰用户或阻断设置页（与 mock 边界一致：取不到就不展示，可下次进入再试）。
   *
   * @param {object} [options]
   * @param {AbortSignal} [options.signal] 取消信号（离开设置页时取消在途请求）
   * @returns {Promise<void>}
   */
  async function loadBackupMeta({ signal } = {}) {
    // 未登录直接清空缓存并返回（卡片据此不展示「上次备份」）
    if (!loggedIn.value || !accessToken.value) {
      backupMeta.value = null
      return
    }
    loadingBackupMeta.value = true
    try {
      const res = await fetchBackupMeta({ signal })
      if (res.status === 'ok') {
        backupMeta.value = {
          hasBackup: true,
          version: res.version,
          size: res.size,
          updatedAt: res.updatedAt
        }
      } else if (res.status === 'empty') {
        backupMeta.value = { hasBackup: false }
      }
      // skipped：保持原缓存不动（理论不达，登录态守卫已挡）
    } catch (err) {
      // 取消信号原样上抛交上层取消逻辑；其余错误静默——副信息拉取失败不打扰用户、不阻断设置页。
      if (err?.name === 'AbortError') throw err
      // 不改 backupMeta：保留上次成功值（若有），避免一次网络抖动抹掉已展示的「上次备份」。
    } finally {
      loadingBackupMeta.value = false
    }
  }

  // ---- 会话 DataKey 管理（包裹式密钥核心）----
  // 包裹式下整库由「随机 DataKey」加密，DataKey 不再由密码直接派生，而是开户时随机生成、
  // 用密码与恢复码各包裹一份。会话内的 DataKey 由登录解包获得，供 cloudBackup / localVault 复用。

  /** 设置会话 DataKey 原始字节并失效旧的 CryptoKey 缓存。 */
  function setSessionDataKey(raw) {
    _dataKeyRaw = raw
    _dataKeyCrypto = null
  }

  /** 清空会话 DataKey（lock / logout / 重置作废时调用）。 */
  function clearSessionDataKey() {
    _dataKeyRaw = null
    _dataKeyCrypto = null
  }

  /** 是否已在会话内持有 DataKey（能否加解密整库）。 */
  function hasDataKey() {
    return _dataKeyRaw != null
  }

  /**
   * 取会话整库 DataKey（AES-GCM CryptoKey，供 cloudBackup / localVault 加解密整库）。
   * 由 _dataKeyRaw 按需导入并缓存；未解锁（无 DataKey）时返回 null，调用方据此跳过。
   * @returns {Promise<CryptoKey | null>}
   */
  async function getDataKey() {
    if (!_dataKeyRaw) return null
    if (!_dataKeyCrypto) _dataKeyCrypto = await importDataKey(_dataKeyRaw)
    return _dataKeyCrypto
  }

  /** 取当前「密码包裹的 DataKey」及其配方，供 cloudBackup 上传时一并写入云端。 */
  function getWrappedDataKey() {
    return { wrappedDataKey: pwWrapped.value, kdfParams: pwKdf.value }
  }

  /**
   * 用内存中的账户密码 + 给定的 pwWrapped/配方解包出会话 DataKey；成功则把这份包裹持久化到本地
   * （供下次同机重登离线解包）。供登录后初始化（useCloudHydrate）在本地无包裹时用云端那份解包。
   * @param {string} wrapped 密码包裹的 DataKey（base64）
   * @param {object} kdf 该包裹的 KDF 配方
   * @returns {Promise<boolean>} 是否解包成功（密码不符 / 数据损坏 → false，不抛）
   */
  async function unlockDataKeyFromWrapped(wrapped, kdf) {
    if (!password.value || !wrapped || !kdf) return false
    try {
      const kek = await deriveKek(password.value, kdf)
      const raw = await unwrapDataKeyRaw(kek, wrapped)
      setSessionDataKey(raw)
      pwWrapped.value = wrapped
      pwKdf.value = kdf
      persistCloudAccount({
        email: email.value,
        userId: userId.value,
        refreshToken: refreshToken.value,
        kdfParams: kdfParams.value,
        pwWrapped: wrapped,
        pwKdf: kdf,
        pendingRecovery: pendingRecovery.value
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 用本地持久化的 pwWrapped + 内存密码尝试解包会话 DataKey。
   * 登录成功后调用：同机重登 / 改密后重登，本地 pwWrapped 即对应当前密码，可离线建立 DataKey。
   * 本地无包裹（换机 / 重置后已清）则返回 false，由云端水合用云端那份解包。
   * @returns {Promise<boolean>}
   */
  async function unlockDataKeyFromLocal() {
    if (!pwWrapped.value || !pwKdf.value) return false
    return unlockDataKeyFromWrapped(pwWrapped.value, pwKdf.value)
  }

  /**
   * 恢复码恢复（决策点 C2）：用恢复码解开云端 recovery-blob 取回 DataKey，再用当前（新）密码
   * 重新包裹并上传，使数据在重置密码后失而复得。调用前置：已登录（持有 access）、password 为新密码。
   * @param {string} code 用户输入的恢复码（容忍大小写 / 连字符差异）
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 恢复成功返回 true；恢复码错误 / 无 recovery-blob 返回 false
   */
  async function recoverWithCode(code, { signal } = {}) {
    const { pullRecoveryBlob, pushSnapshot, pushRecoveryBlob } = await import('@/services/cloudBackup')
    // 1) 取云端 recovery-blob（恢复码包裹的 DataKey）
    const rb = await pullRecoveryBlob({ signal })
    if (!rb) return false
    // 2) 用恢复码解包出 DataKey
    let raw
    try {
      const rcKek = await deriveKek(normalizeRecoveryCode(code), rb.kdfParams)
      raw = await unwrapDataKeyRaw(rcKek, rb.wrappedDataKey)
    } catch {
      return false // 恢复码错误：AES-GCM 验证失败
    }
    setSessionDataKey(raw)
    // 3) 用当前（新）密码重新包裹 DataKey 并持久化 + 上传（更新云端 backup 的 wrappedDataKey）
    const newPwKdf = generateBackupKdfParams()
    const newPwWrapped = await wrapDataKey(await deriveKek(password.value, newPwKdf), raw)
    pwWrapped.value = newPwWrapped
    pwKdf.value = newPwKdf
    // 恢复成功：清待恢复标志并随持久化落盘（false），跨刷新/重登不再提示待恢复
    pendingRecovery.value = false
    persistCloudAccount({
      email: email.value,
      userId: userId.value,
      refreshToken: refreshToken.value,
      kdfParams: kdfParams.value,
      pwWrapped: newPwWrapped,
      pwKdf: newPwKdf,
      pendingRecovery: false
    })
    // 恢复码不变（仍能解同一 DataKey），recovery-blob 无需重传；仅推一次整库使云端 wrappedDataKey 同步
    await pushSnapshot({ signal }).catch(() => {})
    return true
  }

  /**
   * 放弃旧数据、重建钥匙（决策点 C2 兜底：用户**无恢复码**、旧数据不可解密时的正式出路）。
   *
   * 重置密码后旧 DataKey 仅能由恢复码取回；若用户没有恢复码，旧数据在零知识下不可恢复。本 action
   * 生成一把**全新随机 DataKey**：用当前（新）密码包裹持久化、用新生成的恢复码包裹上传 recovery-blob
   * （给用户一份**新恢复码**保存），并以 force 覆盖云端那份不可解密的旧 backup blob（绕过防回退 409）、
   * 落一份以新钥匙加密的整库基线（此刻库通常已清空为空）。此后云备份 / 同步恢复正常。
   *
   * 顺序要点：①先把新 pwWrapped 落入会话 ref（pushSnapshot 内部经 getWrappedDataKey 取它一并上传，
   * 必须先就位，否则重置后 pwWrapped 为 null 会被判 skipped）；②云端写入成功**之后**才清待恢复标志
   * 并持久化 false——若云端写入失败（网络等）则标志保持 true、设置页入口仍在，用户可重试。
   *
   * 前置：已登录（持有 access）、password 为当前新密码。
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<string | null>} 重建成功返回**新恢复码**（供 UI 展示让用户保存）；未登录 / 缺密码返回 null
   * @throws {Error} 云端写入失败（force 覆盖 / recovery-blob 上传）原样上抛，由调用方提示并可重试
   */
  async function rebuildVault({ signal } = {}) {
    if (!loggedIn.value || !accessToken.value || !password.value) return null
    const { pushSnapshot, pushRecoveryBlob } = await import('@/services/cloudBackup')
    // 1) 全新随机 DataKey（独立于密码），即刻设为会话密钥；用新密码包裹一份 pwWrapped
    const raw = generateDataKeyRaw()
    setSessionDataKey(raw)
    const newPwKdf = generateBackupKdfParams()
    const newPwWrapped = await wrapDataKey(await deriveKek(password.value, newPwKdf), raw)
    // 先落会话 ref：pushSnapshot 经 getWrappedDataKey 取 pwWrapped 一并上传，须先就位
    pwWrapped.value = newPwWrapped
    pwKdf.value = newPwKdf
    // 2) 新恢复码 + 以其包裹 DataKey（旧恢复码随新 recovery-blob 覆盖而失效）
    const code = generateRecoveryCode()
    const rcKdf = generateBackupKdfParams()
    const rcWrapped = await wrapDataKey(await deriveKek(normalizeRecoveryCode(code), rcKdf), raw)
    // 3) 云端写入：force 覆盖不可解密的旧 backup（绕过防回退 409）+ 覆盖 recovery-blob。
    //    失败原样上抛——此时尚未清待恢复标志，入口仍在，用户可重试。
    await pushSnapshot({ force: true, signal })
    await pushRecoveryBlob({ wrappedDataKey: rcWrapped, kdfParams: rcKdf, signal })
    // 4) 云端就绪后再清待恢复标志并持久化（含新 pwWrapped/pwKdf），死状态正式解除
    pendingRecovery.value = false
    persistCloudAccount({
      email: email.value,
      userId: userId.value,
      refreshToken: refreshToken.value,
      kdfParams: kdfParams.value,
      pwWrapped: newPwWrapped,
      pwKdf: newPwKdf,
      pendingRecovery: false
    })
    // 5) 透出新恢复码供 UI 展示（复用开户的 pendingRecoveryCode 展示通道）
    pendingRecoveryCode.value = code
    return code
  }

  /**
   * 重新生成恢复码（设置页「恢复码管理」用）：用会话 DataKey 以新恢复码重新包裹一份上传 recovery-blob，
   * 旧恢复码随即失效。前置：已登录且持有会话 DataKey。
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<string | null>} 新恢复码（供 UI 展示），无 DataKey 时返回 null
   */
  async function regenerateRecoveryCode({ signal } = {}) {
    if (!_dataKeyRaw) return null
    const { pushRecoveryBlob } = await import('@/services/cloudBackup')
    const code = generateRecoveryCode()
    const rcKdf = generateBackupKdfParams()
    const rcWrapped = await wrapDataKey(await deriveKek(normalizeRecoveryCode(code), rcKdf), _dataKeyRaw)
    await pushRecoveryBlob({ wrappedDataKey: rcWrapped, kdfParams: rcKdf, signal })
    return code
  }

  /**
   * 开启指纹登录：把当前主密码写入设备安全区（开启前应已通过指纹录入校验）。
   *
   * 零知识要点：指纹不是认证方式，而是「解锁安全区里存的主密码」的闸门。存主密码（而非
   * DataKey / refreshToken）是因为主密码同时能现推 verifier（认证）与 DataKey（解密），
   * 完全复用密码登录链路；存别的只能解一半。本 action 与 settings.biometric 联动置真，二者锁步。
   *
   * @returns {boolean} 成功返回 true；当前无可存的账户凭据（未登录 / 缺密码）返回 false
   */
  function saveBiometricCredential() {
    if (!email.value || !password.value) return false
    saveSecureCredential({ email: email.value, password: password.value })
    hasBiometricCredential.value = true
    // 与设置项锁步：开启指纹凭据即「已开启指纹解锁」
    useSettingsStore().setBiometric(true)
    return true
  }

  /**
   * 关闭指纹登录：清除安全区凭据。用于「设置页主动关闭」以及一切使旧主密码失效的场景
   * （退出登录 / 改密 / 重置密码）。与 settings.biometric 联动置假，二者锁步——清除后
   * 登录页指纹入口自动消失，不会再出现「指纹进入却拿不到合法会话」的僵尸态。
   */
  function clearBiometricCredential() {
    clearSecureCredential()
    hasBiometricCredential.value = false
    useSettingsStore().setBiometric(false)
  }

  /**
   * 指纹登录：从安全区取回主密码后，走与密码登录**完全相同**的真实链路拿合法会话。
   *
   * 调用前置：上层（useUnlock）必须**先**通过指纹验证再调本 action（mock 阶段闸门在调用方；
   * 真机由 Keychain 读取动作自身的指纹保护兜底）。取回主密码后委托 login()——既派生 verifier
   * 认证换 token，又把主密码落入 state 供后续派生 DataKey 解密保险库，从根本上避免「登录了却
   * 解不开库」。
   *
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 登录成功 true；无存档 / 凭据失效 false（AbortError 原样上抛）
   */
  async function loginByBiometric({ signal } = {}) {
    const cred = loadSecureCredential()
    // 无存档：纠正状态（清入口）后让上层回退密码登录
    if (!cred?.email || !cred?.password) {
      clearBiometricCredential()
      return false
    }
    try {
      // 复用 §3 登录：拿真 token + 把主密码落入 state（供 DataKey 解密）
      return await login({ email: cred.email, password: cred.password }, { signal })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      // 401 表示存档主密码已失效（如在他处改过密）→ 清安全区，强制回退密码登录并需重新开启指纹；
      // 其它错误（网络等）保留存档，稍后可重试。
      if (err?.status === 401) clearBiometricCredential()
      return false
    }
  }

  /**
   * 锁定（自动锁定）：仅清本次会话登录态，**保留**账户绑定与 refreshToken。
   * 下次回登录页可用密码 / 指纹快速重新登录（后端会话仍有效，refresh 仍可续签）。
   * 与 logout 的区别：lock 不吊销后端会话、不清 refresh；logout 则连后端会话一并吊销。
   */
  function lock() {
    loggedIn.value = false
    // 自动锁定清会话密钥：丢弃内存中缓存的备份 DataKey（与「lock 仅清会话密钥」语义一致）。
    clearBackupCache()
    // 同步清本地保险库的内存 DataKey 缓存；**保留**落盘密文（重登同账户可秒恢复）。
    clearLocalVaultCache()
    // 清会话 DataKey（包裹式核心密钥），重登时用 pwWrapped 重新解包；落盘密文 / 云端 blob 均保留。
    clearSessionDataKey()
    // 同时清「上次备份」元信息缓存：锁定后重登可能换账户，旧账户的备份元信息不应残留展示。
    backupMeta.value = null
  }

  /**
   * 退出登录。对应 POST /auth/logout（§7）。
   *
   * 与 lock() 的关键区别：lock 仅清会话态、保留 refresh（自动锁定，可快速重登）；logout 连
   * **后端会话一并吊销**（后端 SREM 该 refresh 的 jti）+ 清本地 refreshToken，下次须重走 §3 登录。
   *
   * 本地优先兜底：无论后端成功 / 失败（网络错、access 过期 401 等）都**始终本地完成登出**——
   * 清 loggedIn / accessToken / refreshToken / 会话内存明文密码，并把持久化的 refreshToken 清空
   * （**保留** email/userId/kdfParams 账户绑定，使 hasAccount 仍为真，用户回 /unlock 可重新登录）。
   * 后端未及移除的白名单项由 refresh 的 TTL 自然过期兜底。
   *
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<boolean>} 恒返回 true（本地登出总会成功）
   */
  async function logout({ signal } = {}) {
    try {
      // 仅当握有 access 与 refresh 时才通知后端吊销该会话；缺任一则跳过，直接本地登出
      if (accessToken.value && refreshToken.value) {
        await realLogout(accessToken.value, refreshToken.value, signal)
      }
    } catch (err) {
      // 取消信号原样上抛交上层处理；其余错误（网络 / 401 等）一律吞掉，走下方本地兜底
      if (err?.name === 'AbortError') throw err
    } finally {
      // 本地优先：无论后端结果如何都清会话与 refresh，并清持久化的 refreshToken（保留账户绑定）
      loggedIn.value = false
      accessToken.value = null
      refreshToken.value = null
      // 退出登录清会话密钥：丢弃内存中缓存的备份 DataKey（云端旧 blob 仍在，重登后可继续覆盖）。
      clearBackupCache()
      // 本地保险库：仅清内存 DataKey 缓存，**保留**落盘密文（决策：登出保留，重登同账户秒恢复；
      // 密文按 owner 隔离，换账户时 loadLocalVault 自然不解）。
      clearLocalVaultCache()
      // 清会话 DataKey；pwWrapped 等持久化包裹保留，重登同账户可离线重新解包。
      clearSessionDataKey()
      // 清「上次备份」元信息缓存：登出后回登录页，旧账户的备份元信息不应残留。
      backupMeta.value = null
      // 主动退出 = 本设备会话彻底结束：连安全区指纹凭据一并清除（与 lock 自动锁定区别：lock 保留，
      // 指纹可快速重登）。清除后指纹入口自动消失，避免登出后指纹进入僵尸态。
      clearBiometricCredential()
      // 退出登录顺带清掉会话内存中的明文密码（本就不落盘，这里显式置空避免悬留）
      password.value = null
      persistCloudAccount({
        email: email.value,
        userId: userId.value,
        refreshToken: null,
        kdfParams: kdfParams.value,
        // 登出保留账户绑定，待恢复标志亦保留：重登后仍引导恢复 / 重建
        pendingRecovery: pendingRecovery.value
      })
    }
    return true
  }

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
    // accessToken 暴露给云备份（模块 2）用于 Authorization 头；仍仅内存留存、不持久化。
    accessToken,
    hasBiometricCredential,
    sendingCode,
    authenticating,
    // 云端备份元信息（§3）缓存与拉取态，供设置页云账户卡片展示「上次备份」
    backupMeta,
    loadingBackupMeta,
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
    // 包裹式密钥（零知识）：会话 DataKey 取用 + 包裹元数据 + 恢复码恢复 / 重新生成
    getDataKey,
    hasDataKey,
    getWrappedDataKey,
    unlockDataKeyFromWrapped,
    unlockDataKeyFromLocal,
    recoverWithCode,
    rebuildVault,
    regenerateRecoveryCode,
    pendingRecovery,
    pendingRecoveryCode,
    markLoggedIn,
    // 拉取云端备份元信息（§3），写入 backupMeta 缓存供卡片展示「上次备份」
    loadBackupMeta,
    saveBiometricCredential,
    clearBiometricCredential,
    loginByBiometric,
    lock,
    logout
  }
})

// ===============================================================
// 后端对接区（/auth/* 真实接入 + 本地零知识密钥派生）
// ===============================================================
//
// 说明：
//   - 【已真实接入】sendVerifyCode → POST /auth/verify-code（下发邮箱验证码，见 requestVerifyCode）。
//   - 【已真实接入】register → POST /auth/register（§2 注册开户）：先在本地零知识派生
//     verifier + kdf_params（见 utils/kdf.js，明文密码不出端），再上送后端；后端校验真验证码、
//     落库、签发 token，注册即登录。**不再校验固定 123456**，请输入邮箱实收的真验证码。
//     注册成功后把 kdf_params 持久化到本地（供 §3 登录重算 verifier，非机密）。
//   - 【已真实接入】login → POST /auth/kdf-params + POST /auth/login（§3 登录解锁）：先按邮箱
//     向后端拉取 kdf_params（salt 非机密，公开返回；不依赖本地持久化，故清缓存 / 换设备都能登录），
//     再用该配方在本地重算出同一 verifier（见 realLogin），后端用账户 server_salt 再哈希后恒定
//     时间比对，通过即签发 token。失败计数锁定 → 423、邮箱或密码不正确 → 401。**明文密码不出端**。
//   - 【已真实接入】refresh → POST /auth/refresh（§4 token 静默续签，见 realRefresh）：只上送
//     refreshToken，后端验签 + 白名单（SISMEMBER）通过则**轮转**——SREM 旧 jti 作废、签发新对、
//     SADD 新 jti，返回 { tokens }。客户端回写新 access（内存）+ 新 refresh 并重新持久化新的
//     refreshToken（旧 refresh 已在服务端失效，再调返回 401）。后端 401（refresh 失效 / 被吊销 /
//     已轮转）→ refresh() 触发 lock() 清登录态、清 accessToken，让路由守卫导回登录页（§3）。
//     全程静默、用户无感。
//   - 【已真实接入】changePassword → POST /auth/change-password（§5 修改账户密码，见 realChangePassword）：
//     用**新密码**在本地零知识派生新 { verifier, kdf_params }（新 client salt，明文不出端），带
//     Authorization: Bearer <access> 上送。后端校验 access → 重算落库（新 server_salt 二次慢哈希）→
//     自增 token_version + 清全部 refresh（**含当前设备在内的全部会话一并立即失效**）→ 返回
//     { success, relogin }，**不再下发 token**（方案 B 严格立即失效）。客户端据此**清空本次会话凭据**
//     （loggedIn / access / refresh，含持久化清空 refreshToken），保留 email/userId 账户绑定，由视图层
//     导回登录页（/unlock），用户须用**新密码**重新登录。若首发 401（access 过期）且有 refresh，则先
//     复用底层 realRefresh 续签拿新 access 再重试一次（不走 refresh() action，避免其 lock() 登出副作用）；
//     仍失败把错误上抛。
//   - 【已真实接入】resetPassword → POST /auth/reset-password（§6 忘记密码重置，见 realReset）+
//     随即 POST /auth/login（§3）。用**新密码**在本地零知识派生新 { verifier, kdf_params }（新
//     client salt，明文不出端），仅凭邮箱验证码授权上送（无 access token）。后端校验验证码 →
//     重算落库（新 server_salt 二次慢哈希）→ DEL code → 吊销该用户全部 refresh，返回
//     { resetOk, cloudBackupCleared }（C1：旧云备份失效、需重新上传），**不发 token、不自动登录**。
//     故 store.resetPassword 在 reset 成功后**紧接着用新密码走一次真实 §3 登录**拿合法会话（这是
//     重置后获取会话的正当方式，而非伪造登录态）；二者均调底层裸函数（realReset + realLogin）、
//     由一次 runAuth 包裹，避免嵌套外层 login 触发 runAuth 守卫自锁。**不再校验固定 123456**，
//     请输入邮箱实收的真验证码。
//   - 【已真实接入】logout → POST /auth/logout（§7 退出登录，见 realLogout）：带 access 鉴权 +
//     { refreshToken } 上送，后端 SREM 该单个 refresh 的 jti 吊销当前会话（**不动 token_version、
//     不波及其它设备**，区别于 §5 改密的全量失效），返回 { success }。幂等：refresh 已失效也返回成功。
//     store.logout 做**本地优先兜底**——无论后端成功 / 失败（网络、401 等）都清 loggedIn / access /
//     refresh 并清持久化 refreshToken（保留 email/userId/kdfParams 账户绑定），回 /unlock 重登。
//     与 lock()（自动锁定，仅清会话态、保留 refresh 可快速重登）语义不同，不再互为别名。
//   - 【零知识本地校验，不依赖后端】verifyPassword 用待验密码 + 本地 pwKdf 派生 KEK 试解 pwWrapped 包裹的
//     DataKey，解包成功即密码正确——**不在本地留存任何明文密码**。故 register / login / changePassword /
//     resetPassword 均不再把明文密码写本地，明文密码只在会话内存留存。
//   - 会话态 loggedIn 不持久化；accessToken 仅内存；refreshToken / kdfParams 持久化（续签 / 登录用）。

/** localStorage 持久化 key */
const CLOUD_KEY = 'safevault.cloud'

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

/**
 * 读取持久化的云账户绑定（缺省 / 解析失败回落未注册）。
 * 注意：**不含明文密码**——本地仅存非机密的账户绑定 + 密文包裹（pwWrapped 等），
 * 明文密码只在会话内存留存。旧版本可能残留 password 字段，这里一概忽略不读。
 */
function loadCloudAccount() {
  try {
    const raw = localStorage.getItem(CLOUD_KEY)
    if (!raw) {
      return { email: null, userId: null, refreshToken: null, kdfParams: null, pwWrapped: null, pwKdf: null, pendingRecovery: false }
    }
    const parsed = JSON.parse(raw)
    return {
      email: parsed.email ?? null,
      userId: parsed.userId ?? null,
      refreshToken: parsed.refreshToken ?? null,
      kdfParams: parsed.kdfParams ?? null,
      pwWrapped: parsed.pwWrapped ?? null,
      pwKdf: parsed.pwKdf ?? null,
      // 待恢复标志持久化：重置后跳过恢复的死状态须跨刷新/重登稳定可见（不再仅靠水合推断）
      pendingRecovery: parsed.pendingRecovery ?? false
    }
  } catch {
    return { email: null, userId: null, refreshToken: null, kdfParams: null, pwWrapped: null, pwKdf: null, pendingRecovery: false }
  }
}

/**
 * 写回云账户绑定（隐私模式 / 配额异常时静默降级，不阻断交互）。
 * **绝不写入明文密码**——只持久化非机密的账户绑定与密文包裹。
 */
function persistCloudAccount({
  email,
  userId = null,
  refreshToken = null,
  kdfParams = null,
  pwWrapped = null,
  pwKdf = null,
  pendingRecovery = false
}) {
  try {
    localStorage.setItem(
      CLOUD_KEY,
      JSON.stringify({ email, userId, refreshToken, kdfParams, pwWrapped, pwKdf, pendingRecovery })
    )
  } catch {
    // 不可用时静默
  }
}

/**
 * 真实注册：零知识派生 verifier + kdf_params 后 POST /auth/register（对齐时序图 §2）。
 *
 * 明文密码绝不出端：deriveVerifier 在本地把密码派生成不可逆 verifier，后端只拿 verifier 与配方。
 * 后端校验真验证码 → 落库 → 签发 token，返回 { tokens, userId }。
 * 验证码错误/过期 → 后端 400、邮箱已注册 → 409，均由 http 层抽取 detail 抛出中文 Error。
 *
 * @param {string} addr 已输入的邮箱
 * @param {string} pwd 云账户明文密码（仅本地派生用）
 * @param {string} code 邮箱验证码（真验证码）
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ tokens: { accessToken: string, refreshToken: string }, userId: number }>}
 */
async function realRegister(addr, pwd, code, signal) {
  // 1) 本地零知识派生：明文密码 → verifier(base64) + kdf_params（派生配方）
  const { verifier, kdfParams } = await deriveVerifier(pwd)
  // 2) 上送后端：注意字段名对齐后端 RegisterRequest（snake_case kdf_params）
  const res = await postJson(
    '/auth/register',
    { email: addr, verifier, kdf_params: kdfParams, code },
    { signal }
  )
  // 把 kdfParams 透出供 store 持久化：§3 登录需用同一配方重算 verifier
  return { ...res, kdfParams }
}

/**
 * 真实登录：先向后端拉取该邮箱的 kdf_params，本地重算 verifier 后 POST /auth/login（§3）。
 *
 * 不再依赖本地持久化的派生配方——登录前先 POST /auth/kdf-params 取回注册时的同一份配方
 * （salt 非机密，零知识 / SRP 惯例公开返回；邮箱未注册则返回伪配方，登录自然 401）。
 * 这样清缓存 / 换设备都能正常登录。明文密码绝不出端：deriveVerifierWithParams 用该配方
 * 派生出与注册一致的 verifier，后端用账户已存 server_salt 再哈希后恒定时间比对。
 * 失败计数锁定 → 423、邮箱或密码不正确 → 401，均由 http 层抽取 detail 抛出中文 Error。
 *
 * @param {string} addr 邮箱
 * @param {string} pwd 云账户明文密码（仅本地派生用）
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ tokens: { accessToken: string, refreshToken: string }, userId: number, kdfParams: object }>}
 */
async function realLogin(addr, pwd, signal) {
  // 1) 拉取派生配方（含 client salt）
  const { kdf_params: params } = await postJson('/auth/kdf-params', { email: addr }, { signal })
  // 2) 用该配方在本地重算 verifier（与注册一致）
  const verifier = await deriveVerifierWithParams(pwd, params)
  // 3) 上送后端比对；把 params 一并透出供 store 回填本地（便于离线展示等）
  const res = await postJson('/auth/login', { email: addr, verifier }, { signal })
  return { ...res, kdfParams: params }
}

/**
 * 真实改密：本地两段派生（旧密码核验 + 新密码落库）后 POST /auth/change-password（§5，方案 B）。
 *
 * 明文密码绝不出端：
 *   - old_verifier：用**旧密码 + 旧 kdf_params**（deriveVerifierWithParams）重算出与库里一致的旧
 *     verifier，供后端叠加账户当前 server_salt 慢哈希后恒定时间比对，核验「确实掌握旧密码」；
 *   - verifier / kdf_params：用**新密码**（deriveVerifier）派生新的 verifier + 新 client salt 落库。
 * 请求带 Authorization: Bearer <access> 鉴权。方案 B 下后端校验旧密码 → 重算落库 → 自增
 * token_version + 清全部 refresh（含当前设备会话一并失效），返回 { success, relogin }，**不下发 token**。
 *
 * access 过期处理：首发若 401 且提供了 renewAccess 续签回调，则先续签拿新 access 再**重试
 * 一次**；重试仍失败（或无续签回调）把错误（含 status）上抛，交由上层（changePassword）处理。
 * 重试只做一次，避免 access ↔ refresh 同时失效时陷入循环。
 *
 * 注意：401 也可能是后端「旧密码不正确」（OldPasswordError）。改密页已前置验证身份，正常不会触发；
 * 续签重试对它无效（换 access 不改变旧密码校验结果），最终把该 401 原样上抛由上层提示。
 *
 * @param {object} params
 * @param {string} params.newPassword 新明文密码（仅本地派生用，不留存、不上送）
 * @param {string} params.oldPassword 旧明文密码（仅本地派生 old_verifier 用，不上送）
 * @param {object} params.oldKdfParams 旧 kdf_params（含旧 client salt），用于重算 old_verifier
 * @param {string|null} params.accessToken 当前 access token（鉴权头）
 * @param {() => Promise<string|null>} params.renewAccess 续签回调，返回新 access（无则 null）
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ success: boolean, relogin: boolean }>} 后端响应（方案 B 不含 token）
 */
async function realChangePassword({ newPassword, oldPassword, oldKdfParams, accessToken, renewAccess, signal }) {
  // 1) 本地零知识派生：旧密码（用旧配方重算）→ old_verifier；新密码 → 新 verifier + 新 kdf_params。
  const oldVerifier = await deriveVerifierWithParams(oldPassword, oldKdfParams)
  const { verifier, kdfParams } = await deriveVerifier(newPassword)
  // 请求体字段名对齐后端 ChangePasswordRequest（old_verifier / verifier / snake_case kdf_params）
  const reqBody = { old_verifier: oldVerifier, verifier, kdf_params: kdfParams }

  // 内部小工具：带指定 access token 发一次改密请求
  const send = (token) =>
    postJson('/auth/change-password', reqBody, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    })

  try {
    // 2) 首发：用当前 access 鉴权
    return await send(accessToken)
  } catch (err) {
    // 取消信号原样上抛，不当作鉴权失败
    if (err?.name === 'AbortError') throw err
    // 仅对 401（access 过期 / 无效）尝试续签后重试一次；其它错误直接上抛
    if (err?.status !== 401) throw err
    const newAccess = await renewAccess?.()
    // 续签失败（无 refresh / refresh 也失效）：保留原始 401 错误上抛，让上层导回登录态
    if (!newAccess) throw err
    // 3) 用新 access 重试一次（仅一次，避免循环）
    return await send(newAccess)
  }
}

/**
 * 真实重置：本地用新密码派生新 verifier + kdf_params 后 POST /auth/reset-password（对齐时序图 §6）。
 *
 * 忘记密码场景（无 access token），仅凭邮箱验证码授权。明文密码绝不出端：deriveVerifier 在本地把
 * 新密码派生成新的 { verifier, kdfParams }（含新 client salt），后端只拿 verifier 与配方。后端校验
 * 验证码 → 生成新 server_salt 二次慢哈希后更新 verifier/server_salt/kdf_params → DEL code → 吊销
 * 该用户全部 refresh，返回 { resetOk, cloudBackupCleared }（C1：旧云备份失效，提示重新上传）。
 * 重置**不签发 token**——拿合法会话由调用方随即走一次真实 §3 登录（见 store.resetPassword）。
 * 验证码错误/过期 → 后端 400，由 http 层抽取 detail 抛出中文 Error。
 *
 * @param {string} addr 已绑定的邮箱
 * @param {string} pwd 新明文密码（仅本地派生用，不留存、不上送）
 * @param {string} code 邮箱验证码（真验证码）
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ resetOk: boolean, cloudBackupCleared: boolean }>}
 */
async function realReset(addr, pwd, code, signal) {
  // 1) 本地零知识派生：新明文密码 → 新 verifier(base64) + 新 kdf_params（含新 client salt）
  const { verifier, kdfParams } = await deriveVerifier(pwd)
  // 2) 上送后端：字段名对齐后端 ResetPasswordRequest（snake_case kdf_params）
  return postJson(
    '/auth/reset-password',
    { email: addr, verifier, kdf_params: kdfParams, code },
    { signal }
  )
}

/**
 * 真实续签：POST /auth/refresh（对齐时序图 §4，轮转策略）。
 *
 * 只上送 refresh token；后端校验签名 + 有效期 + 白名单（SISMEMBER），通过则 SREM 旧 jti
 * 作废、签发新对并 SADD 新 jti，返回 { tokens: { accessToken, refreshToken } }。
 * 旧 refresh 用后即失效（再调将 401）。refresh 失效 / 被吊销 → 后端 401「请重新登录」，
 * 由 http 层抽取 detail 抛出带 status 的 Error，交 refresh() action 处理登出。
 *
 * @param {string} token 当前持有的 refresh token
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ tokens: { accessToken: string, refreshToken: string } }>}
 */
function realRefresh(token, signal) {
  return postJson('/auth/refresh', { refreshToken: token }, { signal })
}

/**
 * 真实登出：POST /auth/logout（对齐时序图 §7）。
 *
 * 带 Authorization: Bearer <access> 鉴权 + body { refreshToken } 上送。后端校验 access →
 * 验签 refresh 取 jti → SREM refresh:{userId} 吊销该**单个**会话（不动 token_version、不波及
 * 其它设备），返回 { success: true }。幂等：refresh 已失效 / 不在白名单也返回成功。
 * access 过期 → 后端 401；登出场景无需续签重试，由 store.logout 吞掉错误走本地兜底登出。
 *
 * @param {string} accessToken 当前 access token（鉴权头）
 * @param {string} refreshToken 待吊销的 refresh token
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean }>}
 */
function realLogout(accessToken, refreshToken, signal) {
  return postJson(
    '/auth/logout',
    { refreshToken },
    { signal, headers: { Authorization: `Bearer ${accessToken}` } }
  )
}
