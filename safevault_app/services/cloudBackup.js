/**
 * 云备份编排（模块 2 PUT /backup 上传 + GET /backup 下载）—— 整库快照零知识加解密
 *
 * 上传（pushSnapshot，§1）串起三件事：① 从 vault store 取「活跃 + 回收站」整库快照（决策点 B）；
 * ② 用 services/crypto 就地加密成 { ciphertext, kdfParams, checksum }；③ 带 access token
 * PUT /backup，按时序图 §1 处理 200 / 401（续签重试一次）/ 409（客户端内部并发信号，静默丢弃）/ 413 等。
 *
 * 下载（pullSnapshot，§2）串起：① 带 access token GET /backup（401 续签重试一次）；② 用返回的
 * kdfParams 经 cloudAccount.deriveDataKey 重算 DataKey → decryptJson 还原整库快照；③ 把本地备份
 * 状态 version 同步为云端 version、kdfParams 存为云端这份（owner=当前账户），使后续自动上传取
 * version+1 不被 PUT /backup 的防回退判成 409。404 视为「云端暂无备份」（非错误），密钥不符
 * （决策点 C1：曾重置密码致旧 blob 不可解密）则返回不可解密态供 UI 提示重新上传。
 *
 * 单调 version 本地管理：后端按 version 防回退，客户端持久化「上次成功落库的 version」，每次上传取
 * 其 +1；200 后用后端回传 version 同步本地（force 覆盖时后端会重建基线、回传更高 version，照样同步）。
 * 按账户隔离：本地状态带 owner（邮箱），换账户即视为全新（version 归零、重新生成 backup 配方）。
 *
 * 零知识：本模块只经手密文与派生配方；DataKey 由 cloudAccount.deriveDataKey 在身份中枢内派生，
 * 明文密码不流入本模块；派生出的 CryptoKey 仅在内存缓存（DataKey 不持久化），lock / logout 时清除。
 *
 * 依赖方向：本模块**不静态 import 任何 store**（cloudAccount 反向静态依赖本模块取 clearBackupCache，
 * 静态互引会成环），运行时用动态 import 取 store，规避循环依赖。
 */
import { deleteJson, getJson, putJson } from '@/services/http'
import { decryptJson, encryptJson } from '@/services/crypto'

/** 本地备份状态持久化 key（与 safevault.* 家族统一前缀） */
const STORAGE_KEY = 'safevault.backup'

/**
 * 清除内存缓存的备份 DataKey（兼容接口，保留供 cloudAccount lock/logout 调用）。
 * 包裹式改造后会话 DataKey 统一由 cloudAccount 会话态持有与清理（clearSessionDataKey），
 * 本模块不再缓存任何密钥，故此处为空操作，仅为不改动 cloudAccount 既有调用点而保留。
 */
export function clearBackupCache() {
  // no-op：DataKey 缓存已上移至 cloudAccount 会话态
}

/** 读取本地备份状态（缺省 / 解析失败回落空态） */
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyLocal()
    const parsed = JSON.parse(raw)
    return {
      owner: parsed.owner ?? null,
      version: Number(parsed.version) || 0,
      kdfParams: parsed.kdfParams ?? null,
      updatedAt: parsed.updatedAt ?? null,
      checksum: parsed.checksum ?? null
    }
  } catch {
    return emptyLocal()
  }
}

/** 空的本地备份状态 */
function emptyLocal() {
  return { owner: null, version: 0, kdfParams: null, updatedAt: null, checksum: null }
}

/** 写回本地备份状态（隐私模式 / 配额异常时静默降级） */
function saveLocal(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 不可用时静默：仅丢失「上次备份」展示，不影响上传链路（下次仍按 +1 递增）
  }
}

/** 对外暴露本地备份状态（设置页展示「上次备份」用，无网络成本） */
export function getLocalBackupState() {
  return loadLocal()
}

// 注：包裹式改造后不再在本模块按密码派生 DataKey；整库加解密统一用 cloudAccount 会话内的
// DataKey（account.getDataKey()），换机首登时由 account.unlockDataKeyFromWrapped 用云端 wrappedDataKey 解包。

/** 组装整库快照：活跃条目 + 回收站条目（保留 deletedAt）+ 自定义分类（决策点 B：含回收站） */
function buildSnapshot(vault) {
  return {
    schema: 1,
    exportedAt: Date.now(),
    entries: vault.entries,
    trash: vault.trashedEntries,
    categories: vault.categories
  }
}

/**
 * 带 access token 发 PUT /backup；首发 401（access 过期）则续签一次后重试。
 * 非 401 错误（409 / 413 / 网络）原样上抛，由调用方按语义分流。
 * @param {any} account cloudAccount store 实例
 * @param {object} body { ciphertext, kdfParams, version, checksum, force }
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ version: number, updatedAt: string }>}
 */
async function sendWithAuthRetry(account, body, signal) {
  const send = (token) =>
    putJson('/backup', body, { signal, headers: { Authorization: `Bearer ${token}` } })
  try {
    return await send(account.accessToken)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    if (err?.status !== 401) throw err
    // access 过期：静默续签后用新 access 重试一次（refresh 会把新 access 写回 store）
    const ok = await account.refresh({ signal })
    if (!ok) throw err
    return await send(account.accessToken)
  }
}

/**
 * 上传一次整库快照（覆盖式）。对齐时序图 §1。
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] 显式「用本机数据覆盖云端」（换机兜底，须经用户二次确认）
 * @param {AbortSignal} [options.signal] 取消信号（debounce 合并时取消上一次在途上传）
 * @returns {Promise<{ status: 'ok'|'stale'|'skipped', version?: number, updatedAt?: string }>}
 *   - ok：上传成功（version/updatedAt 为后端回传值）
 *   - stale：后端 409，本次为乱序 / 过期上传，已静默丢弃（不打扰用户）
 *   - skipped：未登录 / 无 access，未发起上传
 * @throws {Error} 413（体积超限）/ 网络等需提示的错误；AbortError 原样上抛
 */
export async function pushSnapshot({ force = false, signal } = {}) {
  // 运行时取 store，规避与 cloudAccount 的静态循环依赖
  const { useCloudAccountStore } = await import('@/stores/cloudAccount')
  const { useVaultStore } = await import('@/stores/vault')
  const account = useCloudAccountStore()
  const vault = useVaultStore()

  // 守卫：未登录或无 access 一律不传（自动备份链路里这是常态，静默跳过）
  if (!account.loggedIn || !account.accessToken) return { status: 'skipped' }

  // 本地状态按账户隔离：换账户即视为全新（归零 version、重置 backup 配方）
  let local = loadLocal()
  if (local.owner !== account.email) {
    local = { ...emptyLocal(), owner: account.email }
  }
  // 包裹式：用会话 DataKey 加密整库；连同「密码包裹的 DataKey」(wrappedDataKey) + 其配方(kdfParams)
  // 一并上传。未解锁会话 DataKey（如未登录解包成功）则无法加密，静默跳过。
  const dataKey = await account.getDataKey()
  const { wrappedDataKey, kdfParams } = account.getWrappedDataKey()
  if (!dataKey || !wrappedDataKey || !kdfParams) return { status: 'skipped' }
  const { ciphertext, checksum } = await encryptJson(dataKey, buildSnapshot(vault))

  // 单调 version：取本地已知云端版本 + 1
  const version = (local.version || 0) + 1
  const body = { ciphertext, wrappedDataKey, kdfParams, version, checksum, force }

  let res
  try {
    res = await sendWithAuthRetry(account, body, signal)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    // 409：客户端内部并发信号（乱序 / 重试旧请求）→ 静默丢弃，不打扰用户（对齐 §1 优化语义）
    if (err?.status === 409) return { status: 'stale' }
    // 413 / 网络等：交由上层（composable）提示
    throw err
  }

  // 200：用后端回传 version / updatedAt 同步本地（force 覆盖时为重建后的基线值）
  saveLocal({
    owner: account.email,
    version: res.version,
    kdfParams,
    updatedAt: res.updatedAt,
    checksum
  })
  return { status: 'ok', version: res.version, updatedAt: res.updatedAt }
}

/**
 * 带 access token 发 GET /backup；首发 401（access 过期）则续签一次后重试。
 * 非 401 错误（404 / 网络）原样上抛，由调用方按语义分流。与 sendWithAuthRetry 同款续签重试模式。
 * @param {any} account cloudAccount store 实例
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ ciphertext: string, kdfParams: object, version: number, checksum: string }>}
 */
async function getWithAuthRetry(account, signal) {
  const send = (token) =>
    getJson('/backup', { signal, headers: { Authorization: `Bearer ${token}` } })
  try {
    return await send(account.accessToken)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    if (err?.status !== 401) throw err
    // access 过期：静默续签后用新 access 重试一次（refresh 会把新 access 写回 store）
    const ok = await account.refresh({ signal })
    if (!ok) throw err
    return await send(account.accessToken)
  }
}

/**
 * 下载并解密云端最新整库快照（覆盖式恢复）。对齐时序图 §2。
 *
 * 用返回的 kdfParams 经 cloudAccount.deriveDataKey 重算 DataKey → decryptJson 还原整库快照对象
 * `{ schema, exportedAt, entries, trash, categories }`（与上传 buildSnapshot 结构对称）。
 *
 * 成功后**把本地备份状态 version 同步为云端 version、kdfParams 存为云端这份**（owner=当前账户），
 * 使后续自动上传取 version+1 时不被 PUT /backup 的防回退判成 409；同时刷新内存缓存的 DataKey
 * 签名，避免后续上传用旧配方重派生。
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @returns {Promise<{ status: 'ok'|'empty'|'undecryptable'|'skipped', snapshot?: object, version?: number }>}
 *   - ok：下载并解密成功（snapshot 为还原后的整库快照，version 为云端版本）
 *   - empty：云端暂无备份（后端 404，非错误）
 *   - undecryptable：解密失败（密钥不符，对应决策点 C1：曾重置密码致旧 blob 不可解密），需重新上传
 *   - skipped：未登录 / 无 access，未发起下载
 * @throws {Error} 401（续签后仍失败）/ 网络等需提示的错误；AbortError 原样上抛
 */
export async function pullSnapshot({ signal } = {}) {
  // 运行时取 store，规避与 cloudAccount 的静态循环依赖（与 pushSnapshot 一致）
  const { useCloudAccountStore } = await import('@/stores/cloudAccount')
  const account = useCloudAccountStore()

  // 守卫：未登录或无 access 一律不发起（恢复入口在已登录的设置页，正常不会命中）
  if (!account.loggedIn || !account.accessToken) return { status: 'skipped' }

  // ① GET /backup（401 续签重试一次）；404 → 云端暂无备份（非错误，归一为 empty）
  let res
  try {
    res = await getWithAuthRetry(account, signal)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    if (err?.status === 404) return { status: 'empty' }
    // 401（续签后仍失败）/ 网络等：交由上层提示
    throw err
  }

  // ② 取会话 DataKey；换机首登（会话尚无 DataKey）则用云端返回的 wrappedDataKey + 当前密码解包。
  //    解包失败（如重置后云端 wrappedDataKey 仍为旧密码包裹）→ 归类 undecryptable，引导恢复码恢复。
  let dataKey = await account.getDataKey()
  if (!dataKey) {
    const unlocked = await account.unlockDataKeyFromWrapped(res.wrappedDataKey, res.kdfParams)
    if (!unlocked) return { status: 'undecryptable' }
    dataKey = await account.getDataKey()
  }

  // ③ 解密还原整库快照；解密失败 = DataKey 不符（数据损坏 / 异常态）
  let snapshot
  try {
    snapshot = await decryptJson(dataKey, res.ciphertext)
  } catch {
    return { status: 'undecryptable' }
  }

  // ④ 同步本地备份状态：version 同步为云端值、kdfParams 存为云端这份（owner=当前账户），
  // 使后续自动上传取 version+1 不被防回退判 409；checksum 一并记录供「上次备份」展示。
  saveLocal({
    owner: account.email,
    version: res.version,
    kdfParams: res.kdfParams,
    updatedAt: Date.now(),
    checksum: res.checksum
  })

  return { status: 'ok', snapshot, version: res.version }
}

/**
 * 上传「恢复码包裹的 DataKey」到云端 recovery-blob（模块 3，决策点 C2）。覆盖式，每账户一份。
 * 注册时上传初始份、设置页重新生成恢复码时覆盖。首发 401（access 过期）则续签后重试一次。
 * @param {object} params
 * @param {string} params.wrappedDataKey 恢复码包裹的 DataKey（base64）
 * @param {object} params.kdfParams 恢复码 KDF 配方
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ status: 'ok'|'skipped' }>}
 */
export async function pushRecoveryBlob({ wrappedDataKey, kdfParams, signal } = {}) {
  const { useCloudAccountStore } = await import('@/stores/cloudAccount')
  const account = useCloudAccountStore()
  if (!account.loggedIn || !account.accessToken) return { status: 'skipped' }
  const send = (token) =>
    putJson('/backup/recovery-blob', { wrappedDataKey, kdfParams }, {
      signal,
      headers: { Authorization: `Bearer ${token}` }
    })
  try {
    await send(account.accessToken)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    if (err?.status !== 401) throw err
    const ok = await account.refresh({ signal })
    if (!ok) throw err
    await send(account.accessToken)
  }
  return { status: 'ok' }
}

/**
 * 拉取「恢复码包裹的 DataKey」（模块 3，决策点 C2）。重置后用恢复码解出 DataKey 时调用。
 * 无 recovery-blob（后端 404）返回 null；首发 401 续签后重试一次。
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ wrappedDataKey: string, kdfParams: object } | null>}
 */
export async function pullRecoveryBlob({ signal } = {}) {
  const { useCloudAccountStore } = await import('@/stores/cloudAccount')
  const account = useCloudAccountStore()
  if (!account.loggedIn || !account.accessToken) return null
  const send = (token) =>
    getJson('/backup/recovery-blob', { signal, headers: { Authorization: `Bearer ${token}` } })
  try {
    return await send(account.accessToken)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    if (err?.status === 404) return null
    if (err?.status === 401) {
      const ok = await account.refresh({ signal })
      if (ok) {
        try {
          return await send(account.accessToken)
        } catch (e) {
          if (e?.status === 404) return null
          throw e
        }
      }
    }
    throw err
  }
}

/**
 * 带 access token 发 GET /backup/meta；首发 401（access 过期）则续签一次后重试。
 * 非 401 错误（网络等）原样上抛，由调用方按语义分流。与 getWithAuthRetry 同款续签重试模式。
 *
 * 注意：§3 元信息接口「无备份」时返回的是 **200 { hasBackup: false }**（非 404），故此处
 * 无 404 特判——无备份是正常 200 响应，由调用方据 res.hasBackup 分流（与 §2 下载的 404 区分）。
 * @param {any} account cloudAccount store 实例
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ hasBackup: boolean, version?: number, size?: number, updatedAt?: string }>}
 */
async function getMetaWithAuthRetry(account, signal) {
  const send = (token) =>
    getJson('/backup/meta', { signal, headers: { Authorization: `Bearer ${token}` } })
  try {
    return await send(account.accessToken)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    if (err?.status !== 401) throw err
    // access 过期：静默续签后用新 access 重试一次（refresh 会把新 access 写回 store）
    const ok = await account.refresh({ signal })
    if (!ok) throw err
    return await send(account.accessToken)
  }
}

/**
 * 仅取云端备份元信息（轻量，不拉 blob / 不解密）。对齐时序图 §3 `GET /backup/meta`。
 *
 * 用于设置页云账户卡片展示「上次备份：刚刚 · 12 KB · v8」。与 pullSnapshot 的关键区别：本函数
 * **只取展示所需的 version / size / updatedAt**，不下载密文、不派生 DataKey、不解密，成本极低，
 * 可在进入设置页时按需拉取。
 *
 * 「无备份」是 §3 的正常返回（后端 200 { hasBackup: false }，非 404），故归一为 `status: 'empty'`
 * 而非错误——与 pullSnapshot 的 empty（那里源于 404）语义一致，调用方一视同仁。
 *
 * 注意：本函数**不**写本地备份状态（saveLocal）——meta 仅供展示，是否「同步本地 version」由真正
 * 经手快照的 push/pull 负责；此处若顺手回写易与上传/下载链路的 version 管理打架，故只读不写。
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @returns {Promise<{ status: 'ok'|'empty'|'skipped', version?: number, size?: number, updatedAt?: string }>}
 *   - ok：命中（version/size/updatedAt 为云端值，updatedAt 为后端 ISO 8601 字符串）
 *   - empty：云端暂无备份（后端 200 hasBackup:false，非错误）
 *   - skipped：未登录 / 无 access，未发起请求
 * @throws {Error} 401（续签后仍失败）/ 网络等需提示的错误；AbortError 原样上抛
 */
export async function fetchBackupMeta({ signal } = {}) {
  // 运行时取 store，规避与 cloudAccount 的静态循环依赖（与 push/pullSnapshot 一致）
  const { useCloudAccountStore } = await import('@/stores/cloudAccount')
  const account = useCloudAccountStore()

  // 守卫：未登录或无 access 一律不发起（设置页未登录时不展示「上次备份」）
  if (!account.loggedIn || !account.accessToken) return { status: 'skipped' }

  // GET /backup/meta（401 续签重试一次）；网络/续签失败等交由上层提示
  const res = await getMetaWithAuthRetry(account, signal)

  // hasBackup=false：云端暂无备份（正常 200），归一为 empty
  if (!res?.hasBackup) return { status: 'empty' }

  // 命中：原样透出展示三项（updatedAt 为后端 ISO 8601 字符串，格式化交给展示层）
  return {
    status: 'ok',
    version: res.version,
    size: res.size,
    updatedAt: res.updatedAt
  }
}

/**
 * 带 access token 发 DELETE /backup；首发 401（access 过期）则续签一次后重试。
 * 非 401 错误（网络等）原样上抛，由调用方按语义分流。与 getWithAuthRetry 同款续签重试模式。
 *
 * 注意：§4 删除接口是**幂等**的——本无备份后端也回 200 { deleted: true }，故无 404 特判。
 * @param {any} account cloudAccount store 实例
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ deleted: boolean }>}
 */
async function deleteWithAuthRetry(account, signal) {
  const send = (token) =>
    deleteJson('/backup', { signal, headers: { Authorization: `Bearer ${token}` } })
  try {
    return await send(account.accessToken)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    if (err?.status !== 401) throw err
    // access 过期：静默续签后用新 access 重试一次（refresh 会把新 access 写回 store）
    const ok = await account.refresh({ signal })
    if (!ok) throw err
    return await send(account.accessToken)
  }
}

/**
 * 彻底删除云端备份（覆盖式销毁）。对齐时序图 §4 `DELETE /backup`（方案 A：开关与删除解耦）。
 *
 * **仅供设置页「删除云端备份」危险操作（经二次确认）调用**——关闭云备份开关只本地停传、绝不调本函数。
 * 后端先删元信息（云端「逻辑上无备份」即时生效）再异步清 OSS blob，且**幂等**（本无备份也回成功）。
 *
 * 删除成功后**清空本地备份状态**（safevault.backup 归零）：避免删除后若重新开启云备份，本地仍残留
 * 旧 version（领先于已清空的云端），导致下次上传取 version+1 仍领先、或展示「上次备份」误导。归零后
 * 重新开启即视为首次备份（version 从 1 起），与「云端已无备份」的事实一致。
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] 取消信号
 * @returns {Promise<{ status: 'ok'|'skipped' }>}
 *   - ok：删除成功（幂等，本无备份也算成功）
 *   - skipped：未登录 / 无 access，未发起请求
 * @throws {Error} 401（续签后仍失败）/ 网络等需提示的错误；AbortError 原样上抛
 */
export async function deleteBackup({ signal } = {}) {
  // 运行时取 store，规避与 cloudAccount 的静态循环依赖（与 push/pull/fetchBackupMeta 一致）
  const { useCloudAccountStore } = await import('@/stores/cloudAccount')
  const account = useCloudAccountStore()

  // 守卫：未登录或无 access 一律不发起（删除入口在已登录设置页，正常不会命中）
  if (!account.loggedIn || !account.accessToken) return { status: 'skipped' }

  // DELETE /backup（401 续签重试一次）；网络/续签失败等交由上层提示
  await deleteWithAuthRetry(account, signal)

  // 删除成功：清空本地备份状态（version 归零），与「云端已无备份」对齐（详见函数注释）
  saveLocal(emptyLocal())

  return { status: 'ok' }
}
