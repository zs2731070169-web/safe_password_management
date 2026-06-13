import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import gapFallback from './scripts/postcss-gap-fallback.cjs'

// uni-app CLI 构建配置（与 HBuilderX 工程结构并存）
// 说明：
//   - HBuilderX 直接读 pages.json / manifest.json 编译，不经此文件；
//   - CLI（uni / vite）构建时读此文件。源码输入根由 UNI_INPUT_DIR 指为项目根（见 package.json 脚本），
//     使 @/stores、@/services、@/styles 等与 HBuilderX 工程「@ 即项目根」的惯例一致。
//   - @ 别名无需在此重声明：uni-app 会按 UNI_INPUT_DIR 内置注入 @ -> 源码根，
//     自定义反而会与之冲突。
//   - 设计 Token（variables + mixins）的全局注入统一交给 uni.scss（uni-app 自动注入每个组件 SCSS），
//     此处不重复注入，否则 @use 会触发 "module already loaded"。
// https://uniapp.dcloud.net.cn/quickstart-cli.html
export default defineConfig({
  plugins: [uni()],
  // PostCSS 插件：为 Flexbox gap 添加 margin 回退，兼容 Chrome <84 / 旧 Android WebView
  css: {
    postcss: {
      plugins: [gapFallback()]
    }
  },
  // H5 开发服务器（dev:h5）：与源工程 safevault_ui 一致，固定端口 5180 并把 /safevault 根反向代理到
  // 本地后端（默认 8000），绕过浏览器跨域。services/http.js 在 dev 留空 VITE_API_BASE_URL 走同源相对路径，
  // 故必须有这条 proxy 才能让登录 / 备份等 /safevault/* 请求真正打到后端（否则请求 404、登录无响应）。
  //   - 后端地址可经环境变量 VITE_DEV_API_TARGET 覆盖；
  //   - 注意：此 proxy 仅对 H5 dev 生效。App（dev:app / 真机）逻辑层用 uni.request 直连，不经此代理，
  //     需另行构建期注入 VITE_API_BASE_URL=<可被设备访问的后端绝对地址>（如 iOS 模拟器 http://localhost:8000、
  //     Android 模拟器 http://10.0.2.2:8000、真机则后端 0.0.0.0 监听 + 局域网 IP）。
  server: {
    // 绑定 IPv4 127.0.0.1（而非默认 IPv6 ::1）：避免本地全局代理（如 Clash）劫持 localhost 拖慢 dev。
    host: '127.0.0.1',
    port: 5180,
    open: true,
    proxy: {
      '/safevault': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
