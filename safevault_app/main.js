import App from './App'
import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import { installStoragePolyfill } from '@/utils/storagePolyfill'
import { installCryptoPolyfill } from '@/utils/cryptoPolyfill'
import { ensureNativeVetted } from '@/utils/nativePbkdf2'
import { notifyActivity } from '@/utils/autoLock'
import './uni.promisify.adaptor'

// App 端无 localStorage：在任何 store/service 初始化之前注入跨端存储垫片，
// 使平移自源工程的逻辑层（直接用 localStorage）在 App 端无感运行（H5 端为 no-op）。
installStoragePolyfill()

// App 端逻辑层（V8/JSCore）无 WebCrypto / TextEncoder / btoa / AbortController：
// 注入与 H5 WebCrypto 逐位互通的纯 JS 密码学垫片，使平移的 crypto.js / kdf.js 无感运行（H5 端为 no-op）。
// 须在 storagePolyfill 之后、任何 store/service 初始化之前。
installCryptoPolyfill()

// 预热 PBKDF2 原生加速自检：App 端启动即异步比对「系统原生 vs noble」是否逐位一致，一致则后续登录的
// verifier / DataKey 派生走系统原生（快一两个数量级），否则回落 noble。提前预热使首次登录前结论已就绪；
// 自检很轻（小迭代两条向量），失败也只是回落，不阻塞启动。H5 端为 no-op。
ensureNativeVetted()

// uni-app Vue3 标准启动：导出 createApp，由框架调用挂载
export function createApp() {
  const app = createSSRApp(App)
  // 挂载 Pinia：逻辑层（stores/）经此提供全局状态，store 签名与 mock 边界保持与源工程一致
  const pinia = createPinia()
  app.use(pinia)

  // 全局活动信号：自动锁定改为「距用户最后一次操作满 N 秒才锁」，需在所有页面感知用户操作。
  // App 端逻辑层无全局 DOM 事件，故用全局 mixin 把 uni 页面级生命周期当作活动信号喂给 autoLock：
  //   - onShow：切页 / 切回 Tab（用户在导航操作）；
  //   - onPageScroll：列表滚动（节流已在 notifyActivity 内部，不会高频 clear/set）。
  // 触摸点击/输入由主停留页根 view 的 @touchstartcapture 补充，导航跳转由 utils/navigation 补充。
  app.mixin({
    onShow() {
      notifyActivity()
    },
    onPageScroll() {
      notifyActivity()
    }
  })

  // 全局错误兜底：真机上渲染 / 逻辑异常默认表现为「白屏 / 闪退」且无可见信息，难以定位。
  // 这里统一捕获并打日志；App 端再弹窗把错误展示到屏幕，便于现场排查（定位完成后可移除弹窗块）。
  app.config.errorHandler = (err, instance, info) => {
    console.error('[全局错误]', info, err)
    // #ifndef H5
    try {
      uni.showModal({
        title: '运行异常（调试）',
        content: `${info}\n${(err && (err.stack || err.message)) || err}`.slice(0, 500),
        showCancel: false
      })
    } catch (_) {}
    // #endif
  }

  return {
    app
  }
}
