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
    port: 5180,
    open: true
  }
})
