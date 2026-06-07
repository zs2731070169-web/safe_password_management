import { Capacitor } from '@capacitor/core'
import { Media } from '@capacitor-community/media'

/**
 * 图片保存平台抽象层
 *
 * 真机（Capacitor 原生环境）调用系统相册插件（@capacitor-community/media），
 * 把图片真正写入手机相册；浏览器 / 无插件环境降级为 `<a download>` 触发下载，
 * 保证 `npm run dev` 下可正常调试。上层（useRecoveryCode）只调用 saveImageToGallery，
 * 不感知运行环境。
 *
 * 为何走原生插件：Android WebView 中点击 `data:` URL 的 `<a download>` 链接通常
 * 静默失败、即便成功也只是落到下载目录而非「相册」，导致「保存为图片」在手机上等于无效。
 * @capacitor-community/media 的 savePhoto 直接支持 base64 data URL，经 MediaStore 写入
 * 相册（基础模式仅需 INTERNET 权限，无需额外存储授权）。
 *
 * 与 services/biometric、services/clipboard 一致采用「静态 import + 运行时按平台启用」：
 * 动态 import() 在个别机型 WebView 会永久挂起，静态 import 把插件打进主包规避；
 * 浏览器侧由 isNativePlatform() 把关，绝不会真正调用原生方法。
 */

/** 相册名（真机相册内会建立同名相簿，如 Android 的 Pictures/SafeVault） */
const ALBUM_NAME = 'SafeVault'

/**
 * 将图片保存到手机相册（真机）或触发浏览器下载（降级）。
 * @param {string} dataUrl image/png 的 dataURL（base64）
 * @param {object} [opts]
 * @param {string} [opts.fileName] 文件名（不含扩展名，仅真机相册用）；浏览器下载用同名 .png
 * @returns {Promise<void>} 成功 resolve，失败抛出异常由上层反馈
 */
export async function saveImageToGallery(dataUrl, { fileName = 'SafeVault-image' } = {}) {
  if (!dataUrl) throw new Error('待保存图片为空')

  // —— 真机：写入系统相册 ——
  if (Capacitor?.isNativePlatform?.()) {
    // Android 要求 savePhoto 携带 albumIdentifier：先找到同名相簿，没有则创建
    const albumIdentifier = await ensureAlbumIdentifier()
    await Media.savePhoto({
      path: dataUrl, // 直接支持 data:image/png;base64,... 形式
      albumIdentifier,
      fileName // 仅 Android 生效，无需扩展名
    })
    return
  }

  // —— 浏览器 / 无插件：降级为 <a download> 下载 ——
  downloadInBrowser(dataUrl, `${fileName}.png`)
}

/**
 * 获取（或创建）应用相簿并返回其 identifier。
 * iOS 不强制 identifier，但统一收敛到同名相簿便于用户查找。
 * @returns {Promise<string|undefined>}
 */
async function ensureAlbumIdentifier() {
  const found = await findAlbum()
  if (found) return found.identifier
  try {
    await Media.createAlbum({ name: ALBUM_NAME })
  } catch {
    // 相簿可能已存在（并发/历史创建）：忽略，回退到再查一次
  }
  const created = await findAlbum()
  return created?.identifier
}

/** 在系统相册中查找应用同名相簿 */
async function findAlbum() {
  const { albums = [] } = await Media.getAlbums()
  return albums.find((a) => a.name === ALBUM_NAME)
}

/** 浏览器降级：用临时 <a download> 触发下载 */
function downloadInBrowser(dataUrl, downloadName) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = downloadName
  document.body.appendChild(link)
  link.click()
  link.remove()
}
