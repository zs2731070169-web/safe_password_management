/**
 * 全局导航守卫 —— uni-app 版（替代源工程 vue-router 的 router.beforeEach）
 *
 * 源工程两道闸：
 *   ① 已注册却访问开户页（且非显式 register=1）→ 重定向回登录页，避免误入重复创建；
 *   ② 受保护页（requiresUnlock）未登录 → 一律回登录页。
 *
 * uni-app 无 beforeEach，改用 `uni.addInterceptor` 拦截 navigateTo / redirectTo / reLaunch，
 * 在跳转发起前按目标页与登录态决定「放行 / 改道」。改道用 invoke 抛出后重新发起目标跳转
 * （uni 拦截器 invoke 返回 false 即拦截本次跳转）。
 *
 * 登录态来源：cloudAccount store 的 hasAccount（是否已注册）与 loggedIn（本次会话是否已登录）。
 * loggedIn 启动恒 false（会话态不持久化），故启动后首次进受保护页必被拦回登录页——符合
 * 「每次启动都要重新登录解锁」的安全预期。
 */
import { useCloudAccountStore } from '@/stores/cloudAccount'

/** 受保护页路径集合（对应源工程 meta.requiresUnlock，未登录不可进） */
const PROTECTED_PATHS = new Set([
  'pages/home/index', // 四 Tab 合并后的主页单页（库 / 健康 / 生成 / 设置）
  'pages/detail/index',
  'pages/add/index',
  'pages/change-password/index',
  'pages/recovery/regenerate',
  'pages/recovery/recover',
  'pages/trash/index',
  'pages/categories/index'
])

/** 登录页路径（改道目标） */
const UNLOCK_PATH = '/pages/unlock/index'
/** 开户页路径 */
const ONBOARDING_PATH = 'pages/onboarding/index'

/** 从完整 url 中剥离出纯路径（去前导斜杠、去 query），便于与集合比对 */
function pathOf(url) {
  if (!url) return ''
  return url.replace(/^\//, '').split('?')[0]
}

/** 解析 url 上的 query 成对象（仅守卫需要的少量取值） */
function queryOf(url) {
  const qs = (url || '').split('?')[1] || ''
  const out = {}
  qs.split('&').forEach((kv) => {
    if (!kv) return
    const [k, v] = kv.split('=')
    out[decodeURIComponent(k)] = decodeURIComponent(v || '')
  })
  return out
}

/**
 * 安装全局导航守卫（在 createApp 之后、首页跳转之前调用，见 main.js）。
 */
export function installNavigationGuard() {
  const intercept = {
    invoke(args) {
      // Pinia 已在 main.js use(pinia) 之后可用；此处惰性取 store 实例
      const auth = useCloudAccountStore()
      const path = pathOf(args.url)

      // 闸②：受保护页未登录 → 改道登录页
      if (PROTECTED_PATHS.has(path) && !auth.loggedIn) {
        uni.reLaunch({ url: UNLOCK_PATH })
        return false // 拦截原跳转
      }

      // 闸①：已注册却访问开户页（非显式 register=1）→ 改道登录页
      if (path === ONBOARDING_PATH && auth.hasAccount) {
        const q = queryOf(args.url)
        if (q.register !== '1') {
          uni.reLaunch({ url: UNLOCK_PATH })
          return false
        }
      }

      return true // 放行
    }
  }

  // 覆盖三类会进入受保护页 / 开户页的跳转 API
  uni.addInterceptor('navigateTo', intercept)
  uni.addInterceptor('redirectTo', intercept)
  uni.addInterceptor('reLaunch', intercept)
}
