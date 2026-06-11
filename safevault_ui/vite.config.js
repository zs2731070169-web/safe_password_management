import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需自动导入 API（ElMessage 等）
    AutoImport({
      resolvers: [ElementPlusResolver()]
    }),
    // Element Plus 组件按需自动注册，减小打包体积
    Components({
      resolvers: [ElementPlusResolver()]
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        // 使用现代编译器 API，消除 legacy-js-api 弃用警告
        api: 'modern-compiler',
        // 全局注入设计 Token 变量与 mixin，业务样式可直接引用
        additionalData: `@use "@/styles/variables.scss" as *; @use "@/styles/mixins.scss" as *;`
      }
    }
  },
  server: {
    // 绑定 IPv4 127.0.0.1（而非默认解析到 IPv6 ::1）：127.0.0.1 已在系统代理绕行列表内，
    // dev 资源请求直连不走代理，避免本地全局代理（如 Clash）劫持 localhost 导致页面加载变慢。
    host: '127.0.0.1',
    port: 5180,
    open: true,
    // 开发联调：前端统一走 /safevault 根（认证 /safevault/auth/*、加密备份 /safevault/backup*），
    // 经这一条反向代理转发到本地后端（默认 8000 端口），绕过浏览器跨域。
    // 后端地址可经 VITE_DEV_API_TARGET 覆盖；生产 / APK 改用 VITE_API_BASE_URL 直连（见 services/http.js）。
    proxy: {
      '/safevault': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
