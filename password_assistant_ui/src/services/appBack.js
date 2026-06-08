import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * 系统返回手势 / 返回键平台抽象层
 *
 * 真机（Capacitor 原生环境）接管 Android 的系统返回：无论曲面屏「右侧侧边往左滑」、
 * 全面屏「边缘内滑」还是导航栏返回键，最终都会触发 @capacitor/app 的 `backButton` 事件。
 * 上层（useSystemBack）据此决定「收回当前弹窗页」还是「退出 App」，避免系统默认直接 finish
 * 整个应用——这正是主流 App 用系统手势收回页面的机制。
 *
 * 浏览器 / 无插件环境：系统返回等价于浏览器后退（popstate），已由 Vue Router 自动处理，
 * 故 addBackButtonListener 返回空回退、不挂任何监听，保证 `npm run dev` 下行为正常。
 */

// 仅真机启用原生 App 插件；浏览器侧由 isNativePlatform() 把关返回 null（不调用插件）。
function nativeApp() {
  return Capacitor?.isNativePlatform?.() ? App : null
}

/**
 * 注册系统返回处理。
 * 真机：监听 `backButton`，回调收到 WebView 是否可后退（canGoBack）。
 * 浏览器：不监听，返回空注销函数（系统返回交还 Vue Router）。
 *
 * @param {(canGoBack: boolean) => void} handler 返回触发时的处理函数
 * @returns {Promise<() => void>} 注销函数（组件卸载时调用）
 */
export async function addBackButtonListener(handler) {
  const app = nativeApp()
  if (!app) return () => {}
  const sub = await app.addListener('backButton', ({ canGoBack }) => handler(Boolean(canGoBack)))
  return () => sub.remove()
}

/** 退出 App（仅真机有效；浏览器为空操作）。 */
export function exitApp() {
  nativeApp()?.exitApp?.()
}
