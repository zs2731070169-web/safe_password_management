/**
 * UTS 原生插件 `@/uni_modules/safevault-pbkdf2` 的测试桩（仅 STR Vitest 环境用）。
 *
 * 真插件是 App 端原生码（Android 落地 / iOS 占位），Node/H5 环境本就不存在该模块——
 * 业务侧 nativePbkdf2.js 的设计即「调用抛错/返回空 → 自检捕获 → 回落 noble 纯 JS」。
 * 本桩返回空字符串，精确复刻「插件不可用」分支，使依赖图能在 Node 解析并走 noble 回落，
 * 与真机标准基座（无插件原生码时）行为一致。不修改任何业务代码。
 */
export function pbkdf2HmacSha256() {
  return '' // 返回空 → 业务侧判定「占位或不可用」抛错 → 回落 noble
}
