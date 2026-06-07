# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

SafeVault（密码安全助手）是一个移动端密码管理 App 的**纯前端 UI 工程**：无后端，所有业务数据走本地 mock。代码基于 Figma 设计稿与 `DRD/`、`PRD/` 文档像素级还原。前端工程位于 `password_assistant_ui/`，其余顶层目录（`DRD/`、`PRD/`）为设计与产品文档。

## 常用命令

所有命令在 `password_assistant_ui/` 目录下执行：

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器，固定端口 5180，自动开浏览器并重定向到 /unlock
npm run build        # vite build，产物在 dist/
npm run preview      # 预览构建产物

# Android 打包（封装 Capacitor + Gradle，幂等，首次运行自动接入 Capacitor）
npm run apk          # 出调试版 APK（自带调试签名，可直接装机），产物归档到 apk-output/
npm run apk:install  # 出调试版并通过 USB 安装 + 启动
npm run apk:release  # 出正式版 APK（签名需经 KEYSTORE_PATH 等环境变量提供，见 build-apk.sh 顶部注释）
```

无 lint / 测试脚本与测试框架；本工程不含自动化测试。APK 打包要求 JDK 21 与 Android SDK（`build-apk.sh` 会自动探测 Android Studio 自带 JBR 与 SDK 路径）。

## 技术栈

Vue 3（Composition API，`<script setup>`，**纯 JavaScript，非 TypeScript**） · Vite 5 · Vue Router 4 · Pinia · Sass/SCSS · Element Plus（按需自动导入）· Capacitor 8（Android 壳）。`@` 别名指向 `src/`。

## 架构

### 分层与数据流

严格的视图 → composable → store 三层，**mock 数据隔离在 store 末尾**：

- **`stores/`** — Pinia store（`auth` / `vault` / `generator` / `health` / `recovery` / `settings`）。每个 store 文件**末尾有一段 `// 以下为 mock 实现，真实接入时替换即可` 的注释区**，集中所有假数据与模拟异步。真实接入后端时，**只替换这段 mock 函数，对外的 actions/getters 签名与视图、composable 全部不动**。改动数据逻辑时遵循这一边界。
- **`composables/`** — 编排交互流程（loading 态、反馈提示、取消/AbortSignal、节流）。视图调用 composable，不直接碰 store 的异步细节。
- **`views/<feature>/`** — 每个功能页一个目录，`XxxView.vue` 为主视图，私有子组件放其下的 `components/`。跨页复用的才放顶层 `src/components/`。

mock 约定示例（`stores/`）：主密码默认 `123456`；vault 内置 5 条样本条目，刻意包含弱密码（GitHub `123456`）与重复密码（微信/YouTube 共用 `Welcome@2024`）以驱动「健康度」页逻辑。

### 路由与导航过渡（`router/index.js`）

- `requiresUnlock: true` 的路由由全局 `beforeEach` 守卫，未解锁一律重定向回 `/unlock`。
- `/` 下挂 `MainTabLayout.vue` 作为**常驻外壳**（固定顶栏 + 底栏），库/健康/生成/设置四个 Tab 为其子路由，URL 仍是 `/vault`、`/health` 等。Tab 页用 `meta.tab` 标记。
- 解锁、恢复码、新增/编辑密码等为独立全屏布局（`meta.fullscreen`），不在外壳内。
- **过渡方向有状态**：`afterEach` 据 Tab 顺序（`constants/tabs.js`）写 `routeTransition`（Tab 间左右滑）与 `outerTransition`（新增/编辑走 `sheet-up/down` 模态卡片，其余淡入淡出），视图层读取这两个响应式对象决定动画。
- 路由注册顺序敏感：`/vault/add`、`/vault/:id/edit` 必须先于 `/vault/:id`，否则被动态段误匹配。

### 样式系统

- 设计 Token 全集中在 `styles/variables.scss`（颜色/字号/间距/圆角/阴影），`vite.config.js` 通过 `additionalData` 全局注入 `variables.scss` 与 `mixins.scss`，业务 SCSS 可直接用变量/mixin。**业务样式禁止硬编码颜色/尺寸，一律引用 Token。**
- 双主题 light/dark + 全局开关（深色模式 / 大字体「Senior +2pt」/ 账号脱敏），见 `composables/useTheme.js`、`stores/settings.js`。
- 双字体策略：Inter 用于 UI，JetBrains Mono 用于敏感数据（密码/恢复码/2FA）；敏感数据默认脱敏显示 `●●●●●●`。
- 移动端画布：`App.vue` 居中约束宽度（约 390–480px）模拟手机；桌面浏览器建议用 DevTools 移动视图查看。

### Element Plus 使用边界

仅按需使用 `ElMessage` / `ElMessageBox` / `ElInput` 等少量组件。**表单控件（开关、滑块、单选）一律用原生 `<input>` + 自定义 CSS 还原，不用 `el-switch` / `el-slider`**（EP 默认样式与设计差异大、覆盖成本高）。新引入某个 EP 组件时，需在 `main.js` 手动补对应的 `element-plus/theme-chalk/el-xxx.css`（按需导入不会自动带组件 CSS）。

### 原生能力（Capacitor）

`services/` 封装平台能力并提供浏览器 mock 回退：`biometric.js`（生物识别，真机系统指纹 / 浏览器 mock）、`clipboard.js`（复制后提示「60s 后清除剪贴板」）、`imageSaver.js`（恢复码存图）。这些 service 隔离了 `@capacitor/*` 调用，视图不直接依赖 Capacitor。

## 写代码约定

- 全程使用中文：回复、文档、代码注释一律简体中文。
- 现有代码注释密度高且为中文，新增代码保持同样风格与命名习惯。
- 新功能页遵循 `views/<feature>/{XxxView.vue, components/}` + 对应 `composables/useXxx.js` + 必要时 `stores/xxx.js` 的既有结构。
