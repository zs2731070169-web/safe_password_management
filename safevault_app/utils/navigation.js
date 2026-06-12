/**
 * 路由导航适配层 —— 把源工程的「按 name 跳转」翻译为 uni 的「按 path 跳转」
 *
 * 源工程（vue-router）统一用 router.push({ name, params })；uni-app 用 url 路径 + query。
 * 本层维护 name → pages.json path 的单一映射，并按页面性质选择合适的 uni 跳转 API，
 * 使上层（composables / 视图）的调用从 `router.push({ name:'X', params:{id} })`
 * 平移为 `navTo('X', { id })`，改动最小、语义一致。
 *
 * 跳转 API 选择策略（呼应源工程的路由过渡语义，见 pages.json 注释）：
 *   - SHEET / 详情 / 子页：uni.navigateTo —— 入栈、自带「右进右出」过渡（对齐源 sheet-right）；
 *   - 四个主 Tab（库/健康/生成/设置）：uni.reLaunch —— 本工程不用原生 tabBar，Tab 间切换
 *     视为「重置到该 Tab」，清掉子页栈避免越积越深（外壳/底栏由各 Tab 页自绘还原）；
 *   - 登录态重置类（Unlock）：uni.reLaunch —— 清空历史栈，防止返回键退回已登录页面。
 *
 * @see pages.json 路由表与映射规则
 */

/**
 * 源路由 name → uni 页面路径（不含前导斜杠，uni url 以 pages/ 开头）。
 * 与 vue-router 的 SHEET_ROUTES / Tab 命名一一对应。
 */
const NAME_TO_PATH = {
  // —— 登录 / 开户 / 重置流程 ——
  Unlock: 'pages/unlock/index',
  MasterPassword: 'pages/unlock/master',
  Onboarding: 'pages/onboarding/index',
  ResetPassword: 'pages/recovery/reset',
  // —— 四个主 Tab ——
  // 四 Tab 已合并进单页 home（pages/home/index）：name 统一指向 home，
  // 由 TAB_NAME_TO_KEY 决定落地哪个 Tab（buildUrl 注入 ?tab=key，home onLoad 读取）。
  Vault: 'pages/home/index',
  Health: 'pages/home/index',
  Generate: 'pages/home/index',
  Settings: 'pages/home/index',
  // —— SHEET / 子页 ——
  PasswordDetail: 'pages/detail/index',
  AddPassword: 'pages/add/index',
  EditPassword: 'pages/add/index', // 编辑复用新增页，带 id query 即编辑模式
  ChangeMasterPassword: 'pages/change-password/index',
  RegenerateRecovery: 'pages/recovery/regenerate',
  RecoverData: 'pages/recovery/recover',
  Trash: 'pages/trash/index',
  CategoryManage: 'pages/categories/index',
  PrivacyPolicy: 'pages/about/privacy'
}

/** 主 Tab 名集合：切换走 reLaunch（重置到 home 对应 Tab，清子页栈） */
const TAB_NAMES = new Set(['Vault', 'Health', 'Generate', 'Settings'])
/** 主 Tab 名 → home 的 tab query 值（决定落地哪个 Tab，与 constants/tabs 的 key 一致） */
const TAB_NAME_TO_KEY = {
  Vault: 'vault',
  Health: 'health',
  Generate: 'generate',
  Settings: 'settings'
}
/** 登录态重置类：走 reLaunch 清空历史栈 */
const RELAUNCH_NAMES = new Set(['Unlock'])

/**
 * 把 name + params 拼成完整 uni url（path?key=val）。
 * @param {string} name 源路由 name
 * @param {Record<string, any>} [params] 路径参数（源工程的 params，统一降级为 query）
 * @returns {string} 完整 url
 */
function buildUrl(name, params) {
  const path = NAME_TO_PATH[name]
  if (!path) {
    console.error('[navigation] 未知路由 name：', name)
    return ''
  }
  // 主 Tab：把 name 转成 home 的 ?tab=key（合并入 params，调用方原传的 params 仍保留）
  const finalParams = TAB_NAME_TO_KEY[name]
    ? { tab: TAB_NAME_TO_KEY[name], ...params }
    : params
  const qs = buildQuery(finalParams)
  return qs ? `/${path}?${qs}` : `/${path}`
}

/** 把对象拼成 query 字符串（已 encodeURIComponent；空值跳过） */
function buildQuery(params) {
  if (!params) return ''
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

/**
 * 前往某页（等价 router.push）。按页面性质自动选择 navigateTo / reLaunch。
 * @param {string} name 源路由 name
 * @param {Record<string, any>} [params] 参数（降级为 query）
 */
export function navTo(name, params) {
  const url = buildUrl(name, params)
  if (!url) return
  if (TAB_NAMES.has(name) || RELAUNCH_NAMES.has(name)) {
    uni.reLaunch({ url })
  } else {
    uni.navigateTo({ url })
  }
}

/**
 * 重定向（等价 router.replace）：当前页出栈、目标页入栈，不可返回到当前页。
 * 登录态重置类（Unlock）走 reLaunch 清空整栈。
 * @param {string} name
 * @param {Record<string, any>} [params]
 */
export function navReplace(name, params) {
  const url = buildUrl(name, params)
  if (!url) return
  if (RELAUNCH_NAMES.has(name) || TAB_NAMES.has(name)) {
    uni.reLaunch({ url })
  } else {
    uni.redirectTo({ url })
  }
}

/** 上次 navBack 触发时刻（去抖用）：collapse 极短窗口内的重复返回，兜底「连退两层」 */
let _lastNavBackAt = 0

/**
 * 返回上一页（等价 router.back）。无上层页时静默（已在栈底）。
 *
 * 去抖兜底：navigateBack 是异步出栈，若同一收回动作被多源触发（如 JS 左滑手势 + 系统返回），
 * 两次 navigateBack 可能在栈更新前先后发出，导致「连退两层」。这里对 350ms 内的重复调用直接
 * 丢弃，保证一次收回只退一层；正常用户操作间隔远大于此窗口，不受影响。
 *
 * @param {number} [delta=1] 返回层数
 */
export function navBack(delta = 1) {
  const now = Date.now()
  if (now - _lastNavBackAt < 350) return
  const pages = getCurrentPages()
  if (pages.length > 1) {
    _lastNavBackAt = now
    uni.navigateBack({ delta })
  }
  // 栈底(如直接落在 Tab 页)无可返回：交由调用方/系统返回逻辑处理，这里不强退
}

/**
 * 防御性解码路由参数 —— 抹平「App 端 onLoad query 不自动解码」的跨端差异。
 *
 * buildQuery 在发起跳转时对参数值做了 encodeURIComponent；H5 端 onLoad 拿到的 query 已被框架
 * 自动解码，App 端却可能保留 `%xx` 原样（旁证：guard.queryOf 也需手动 decode）。含中文 / 特殊
 * 字符的值（如以中文名派生的条目 id `entry-3-微信`）在 App 上会因此与库内真实 id 不匹配，导致
 * 详情 / 编辑页 getEntry 落空、被守卫弹回列表。
 *
 * 故页面 onLoad 取到 query 值后统一过此函数：循环解码到稳定（兼容未编码 / 单次 / 多次编码三种
 * 形态），对已解码的 ASCII / 中文值是无害的幂等操作。解码失败（残缺 %）时返回当前值兜底。
 *
 * @param {string} raw onLoad query 中的原始值
 * @returns {string} 解码到稳定后的值
 */
export function decodeParam(raw) {
  let val = raw || ''
  // 至多三轮：覆盖单次 / 双重编码，循环到不再变化即停
  for (let i = 0; i < 3; i++) {
    let next
    try {
      next = decodeURIComponent(val)
    } catch {
      break // 非法编码（残缺 %）：保留当前值
    }
    if (next === val) break
    val = next
  }
  return val
}

/** 当前页路径（不含 query），便于守卫 / 判活 */
export function currentPath() {
  const pages = getCurrentPages()
  const top = pages[pages.length - 1]
  return top ? `/${top.route}` : ''
}
