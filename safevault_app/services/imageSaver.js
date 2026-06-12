/**
 * 图片保存平台抽象层 —— uni-app 版
 *
 * 真机（App 端）把 base64 图片写入手机相册（uni.saveImageToPhotosAlbum，需先落临时文件）；
 * H5 端 saveImageToPhotosAlbum 不可用，降级为 `<a download>` 触发下载，保证浏览器调试可走通。
 * 上层（RecoveryCodeReveal）只调用 saveImageToGallery，不感知运行环境。
 *
 * —— 自源工程（Capacitor @capacitor-community/media）迁移而来 ——
 * 对外 saveImageToGallery(dataUrl, { fileName }) 签名保持一致：成功 resolve、失败 throw。
 *
 * 关键差异：uni.saveImageToPhotosAlbum 的 filePath 只接受**本地文件路径**，不接受 dataURL，
 * 故 App 端需先用 plus.io 把 base64 写成临时文件，再保存进相册、保存后清理临时文件。
 */

/**
 * 将图片保存到手机相册（App）或触发浏览器下载（H5 降级）。
 * @param {string} dataUrl image/png 的 dataURL（base64，形如 data:image/png;base64,xxx）
 * @param {object} [opts]
 * @param {string} [opts.fileName] 文件名（不含扩展名）；H5 下载用同名 .png
 * @returns {Promise<void>} 成功 resolve，失败抛出异常由上层反馈
 */
export async function saveImageToGallery(dataUrl, { fileName = 'SafeVault-image' } = {}) {
  if (!dataUrl) throw new Error('待保存图片为空')

  // #ifdef APP-PLUS
  // —— App：base64 → 临时文件 → 写入系统相册 ——
  const tempPath = await writeBase64ToTempFile(dataUrl, fileName)
  try {
    await saveToAlbum(tempPath)
  } finally {
    // 清理临时文件（保存成败都尝试清理，避免堆积）
    cleanupTempFile(tempPath)
  }
  return
  // #endif

  // #ifndef APP-PLUS
  // —— H5 / 其它：降级为 <a download> 下载 ——
  downloadInBrowser(dataUrl, `${fileName}.png`)
  // #endif
}

// #ifdef APP-PLUS
/**
 * 把 base64 dataURL 写入应用私有临时目录，返回 plus 文件路径（_doc/...）。
 * @param {string} dataUrl
 * @param {string} fileName 不含扩展名
 * @returns {Promise<string>} 临时文件路径
 */
function writeBase64ToTempFile(dataUrl, fileName) {
  return new Promise((resolve, reject) => {
    // 仅取 base64 主体（去掉 data:image/png;base64, 前缀）
    const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '')
    const path = `_doc/${fileName}-${Date.now()}.png`
    try {
      const bitmap = new plus.nativeObj.Bitmap('saveImg-' + Date.now())
      // loadBase64Data 接受完整 dataURL；保留原始 dataUrl 传入更稳妥
      bitmap.loadBase64Data(
        dataUrl,
        () => {
          bitmap.save(
            path,
            { overwrite: true, format: 'png' },
            () => {
              bitmap.clear()
              resolve(path)
            },
            (e) => {
              bitmap.clear()
              reject(new Error('图片落地失败：' + (e?.message || '')))
            }
          )
        },
        (e) => {
          bitmap.clear()
          reject(new Error('图片解析失败：' + (e?.message || '')))
        }
      )
    } catch (e) {
      reject(new Error('图片处理异常：' + (e?.message || '')))
    }
  })
}

/**
 * 保存本地图片到系统相册。
 * @param {string} filePath plus 本地文件路径
 * @returns {Promise<void>}
 */
function saveToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => {
        const msg = err?.errMsg || ''
        // 用户拒绝相册权限：给出可操作提示
        if (msg.includes('auth') || msg.includes('deny')) {
          reject(new Error('未授予相册权限，请到系统设置中开启后重试'))
        } else {
          reject(new Error('保存到相册失败：' + msg))
        }
      }
    })
  })
}

/** 清理临时文件（失败静默，不影响主流程） */
function cleanupTempFile(path) {
  try {
    plus.io.resolveLocalFileSystemURL(
      path,
      (entry) => entry.remove(() => {}, () => {}),
      () => {}
    )
  } catch {
    // 静默
  }
}
// #endif

// #ifndef APP-PLUS
/** H5 降级：用临时 <a download> 触发下载 */
function downloadInBrowser(dataUrl, downloadName) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = downloadName
  document.body.appendChild(link)
  link.click()
  link.remove()
}
// #endif
