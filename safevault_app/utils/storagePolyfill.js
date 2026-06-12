/**
 * localStorage 跨端垫片（仅 App 端注入）
 *
 * 背景：阶段 1 自源工程逐字节平移过来的逻辑层（stores/* 与 services/localVault、
 * secureCredential、cloudBackup 等）大量直接使用浏览器 `localStorage`（同步读写）。
 * H5 端原生支持 localStorage，无需处理；但 **App 端（app-plus，逻辑层跑在 JSCore）
 * 不存在 localStorage**，直接调用会抛 ReferenceError。
 *
 * 设计取舍——为何用「全局垫片」而非逐个改 import：
 *   uni 的 `uni.getStorageSync / setStorageSync / removeStorageSync / clearStorageSync`
 *   与 `localStorage.getItem / setItem / removeItem / clear` 语义与同步性几乎一一对应，
 *   且 App 端同步存储 API 可靠。故在 App 端启动最早期把一个「形如 localStorage」的对象
 *   挂到 globalThis 上，代理到 uni 同步存储——这样**所有平移文件零改动**，既守住
 *   「逻辑层逐字节一致 / 上层零感知」的迁移原则，又抹平了平台差异。
 *
 * 仅覆盖源工程实际用到的 API：getItem / setItem / removeItem / clear。
 * 真实接入硬件安全区（Keychain/Keystore）时，secureCredential 等仍按其自身注释单独替换，
 * 与本垫片无冲突（本垫片只是兜住「明文 KV」这层）。
 */

/**
 * 在 App 端把 localStorage 垫片挂到 globalThis（H5 端为 no-op）。
 * 须在 createApp / 任何 store 初始化「之前」调用（见 main.js）。
 */
export function installStoragePolyfill() {
  // #ifdef APP-PLUS
  // 已存在（极少数自定义基座注入过）则不覆盖
  if (typeof globalThis !== 'undefined' && !globalThis.localStorage) {
    globalThis.localStorage = {
      /** 读取（无值返回 null，与 Web localStorage 一致） */
      getItem(key) {
        const v = uni.getStorageSync(key)
        // uni 同步读未命中时返回空字符串 ''；统一规整为 null 以贴合 Web 语义
        return v === '' || v === undefined || v === null ? null : v
      },
      /** 写入（值统一转字符串，与 Web localStorage 一致） */
      setItem(key, value) {
        uni.setStorageSync(key, String(value))
      },
      /** 删除单键 */
      removeItem(key) {
        uni.removeStorageSync(key)
      },
      /** 清空全部（源工程未用，仅为完备性补齐） */
      clear() {
        uni.clearStorageSync()
      }
    }
  }
  // #endif
  // #ifndef APP-PLUS
  // H5 端原生 localStorage 即可，无需任何处理
  // #endif
}
