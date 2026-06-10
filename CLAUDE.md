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

mock 约定示例（`stores/`）：主密码不再硬编码——新用户首次启动须经**开户流程**（`views/onboarding`，设主密码 → 存恢复码）设置主密码，主密码与「是否已开户」标记持久化到 localStorage（`safevault.master` / `safevault.account`，mock 明文，真实接入改存 Argon2id 哈希）；开发/演示时清掉 `safevault.*` 即可重走开户。vault 内置 5 条样本条目，刻意包含弱密码（GitHub `123456`）与重复密码（微信/YouTube 共用 `Welcome@2024`）以驱动「健康度」页逻辑。指纹默认关闭，开户不涉及，用户在设置页自行开启（开启录入 / 关闭前验证已实现）。

### 路由与导航过渡（`router/index.js`）

- 全局 `beforeEach` 两道闸：①未开户（`auth.hasMasterPassword` 为 false）一律拦至 `/onboarding`（连解锁/找回页也拦）；②`requiresUnlock: true` 的路由未解锁则重定向回 `/unlock`。`hasMasterPassword` 在 store 初始化即从 localStorage 同步读出，守卫可同步判断。
- `/` 下挂 `MainTabLayout.vue` 作为**常驻外壳**（固定顶栏 + 底栏），库/健康/生成/设置四个 Tab 为其子路由，URL 仍是 `/vault`、`/health` 等。Tab 页用 `meta.tab` 标记。
- 开户/解锁流程页（开户、解锁、主密码、找回恢复码、重设主密码）为 `meta.fullscreen` 全屏布局，不在外壳内。
- **「自右弹出」类页面**（详情、新增、编辑、修改主密码、恢复码管理、回收站）由 `router/index.js` 顶部的 `SHEET_ROUTES` 集合枚举：它们是与外壳平级的顶层路由（无 `fullscreen`、不在 `MainTabLayout` 内），点击进入时自右滑入、离开时向右滑回，并支持屏幕上向左滑动反向收回的手势（见 `composables/useSheetDismiss`）。
- **过渡方向有状态**：`afterEach` 同时维护两个响应式对象供视图读取 —— `routeTransition`（据 `constants/tabs.js` 的 Tab 顺序决定 Tab 间左右滑），与 `outerTransition`（`SHEET_ROUTES` 页面前进打开走 `sheet-right` 自右滑入、关闭/后退走 `sheet-close` 向右滑回，其余 `fade` 淡入淡出）。开/关方向靠 `window.history.state.position` 比对前进后退判别，因详情↔编辑互为弹出页，单看目标无法区分开关。
- 路由注册顺序敏感：`/vault/add`、`/vault/:id/edit` 必须先于 `/vault/:id`，否则被动态段误匹配。

### 样式系统

- 设计 Token 全集中在 `styles/variables.scss`（颜色/字号/间距/圆角/阴影），`vite.config.js` 通过 `additionalData` 全局注入 `variables.scss` 与 `mixins.scss`，业务 SCSS 可直接用变量/mixin。**业务样式禁止硬编码颜色/尺寸，一律引用 Token。**
- 当前仅单一 light 主题：`variables.scss` 无 dark token，亦无 `useTheme.js` / 大字体缩放。`stores/settings.js` 持有的偏好只有四项 —— 生物识别、自动锁定时长、账号脱敏（`maskAccount`）、云备份；其中只有**账号脱敏**影响显示（经 `utils/maskAccount.js`）。新增主题/字号能力时需自行补 token 与应用逻辑。
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
