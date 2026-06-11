import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// Element Plus 基础样式（ElMessage 等运行时组件依赖）
// el-var.css 提供根级 CSS 变量（--el-color-* / --el-border-* 等）；
// 各组件 CSS 的背景、边框、圆角全部引用这些变量，缺失会导致消息盒子背景/边框失效，只剩文字
import 'element-plus/theme-chalk/el-var.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-input.css'

// 全局样式（含 reset / 字体 / 主题变量）
import './styles/index.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
