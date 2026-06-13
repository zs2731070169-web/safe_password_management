<script>
import { useLocalPersist } from '@/composables/useLocalPersist'
import { useCloudHydrate } from '@/composables/useCloudHydrate'
import { useCloudBackup } from '@/composables/useCloudBackup'
import { installNavigationGuard } from '@/utils/guard'
import { setupAutoLock, onAppForeground, onAppBackground } from '@/utils/autoLock'

/**
 * App.vue —— 应用根（uni-app）
 *
 * 承载源工程中由 App.vue（渲染根）+ router 守卫共同提供的「全局副作用」：
 *   1) 全局导航守卫（installNavigationGuard）：未登录拦受保护页回登录、已注册拦开户页；
 *   2) 本地加密持久化（useLocalPersist）：整库变更防抖落盘、登录后解密恢复（纯 watch，App.vue 可用）；
 *   3) 自动锁定：前后台/熄屏 + 空闲计时到期锁定回登录页。
 *
 * 【系统返回为何不再自行接管 backbutton】
 *   早期版本在此用 plus.key.addEventListener('backbutton') 注册全局返回监听，企图统一
 *   「子页 navigateBack 收回 / 根页退出」。但该监听**并不会顶替 uni-app 框架自带的默认返回
 *   行为**，二者对同一次返回手势会各处理一遍——收回 SHEET 弹窗时框架默认那一遍触达根页，
 *   就会冒出「再按一次退出应用」提示，导致右侧边缘左滑收回弹窗时极易误退 App。
 *   故彻底移除自定义监听，回归框架内置返回栈：子页返回即 navigateBack 收回（pop-out 右滑回），
 *   根页（home）返回为框架默认的「再按一次退出应用」，正是期望行为，且比旧的直接退出更安全。
 *
 * 自动锁定为何抽成 utils/autoLock 单例、由 App.vue 生命周期驱动：
 *   原 useAutoLock composable 依赖 onMounted 注册监听，而 **uni-app 的 App.vue 没有视图、
 *   onMounted 不触发**，故从未生效。改为模块级单例 utils/autoLock：状态挂在模块作用域，
 *   App.vue 在 onLaunch 调 setupAutoLock()、onShow/onHide 调 onAppForeground/onAppBackground 驱动；
 *   单例对外暴露 notifyActivity() 作为「用户活动」统一入口，由全局 mixin（main.js）/ 导航工具 /
 *   页面触摸喂入活动信号，实现「操作中不锁、闲置才锁」。useLocalPersist 只用 watch，onLaunch 内调用即激活。
 */
export default {
  onLaunch() {
    // 1) 安装全局导航守卫（须在任何受保护页跳转前）
    installNavigationGuard()

    // 2) 本地加密持久化：watch 链路，onLaunch 内调用即生效（与渲染无关）
    //    放进 try 容错：即便此处异常也不阻断应用启动
    try {
      useLocalPersist()
    } catch (e) {
      console.error('[App] useLocalPersist 初始化失败：', e)
    }

    // 2b) 云端水合 / 备份：与 useLocalPersist 对称，同为纯 watch 链路，onLaunch 内激活即生效。
    //     缺了这步则「云备份」开关 / 库变更 / 登录后云端同步全部失效（开关只翻标志、无人监听）。
    //       - useCloudHydrate：登录后「下载优先」用云端整库覆盖本地；
    //       - useCloudBackup：库变更防抖上传 + 云备份开关「关→开」首次全量上传。
    try {
      useCloudHydrate()
      useCloudBackup()
    } catch (e) {
      console.error('[App] 云端水合/备份初始化失败：', e)
    }

    // 3) 自动锁定：初始化单例（注册登录态/时长 watch + 启动空闲计时；H5 端额外挂 DOM 活动监听）
    setupAutoLock()

    // 系统返回不再自行接管：交还 uni-app 框架内置返回栈（见顶部注释）。
  },

  onShow() {
    // 回到前台：自动锁定的「熄屏停留超阈值即锁」判断
    onAppForeground()
  },

  onHide() {
    // 进入后台/熄屏：停止前台计时并记录时刻
    onAppBackground()
  }
}
</script>

<style lang="scss">
/* 每个页面公共 css。设计 Token 已由 uni.scss 全局注入，业务样式在各页用变量/mixin。 */
@import '@/styles/index.scss';
</style>
