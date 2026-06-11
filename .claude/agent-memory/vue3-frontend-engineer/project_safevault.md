---
name: project-safevault
description: SafeVault（密码安全助手）项目概览：纯前端 Vue3 DRD 还原，移动端 App 风格，前端工程输出在 safevault_ui/
metadata:
  type: project
---

SafeVault / 密码安全助手，是一个移动端密码管理 App 的纯前端 UI 还原项目（无后端，数据走本地 mock）。

**Why:** 任务是把 13 屏 UI 设计原型改造为生产级 Vue3 工程，作为前端基线。
**How to apply:** 前端工程输出在项目根 `password_assistant_ui/`（Vue3 `<script setup>` + TS + Vite + Pinia + Sass）。设计是移动端 App 风格（max-width 480px 居中），多数为定制原子组件，Element Plus 仅做基础能力补充，避免默认样式破坏视觉。

关键约定：
- 双字体策略：Inter（UI）+ JetBrains Mono（敏感数据：密码/恢复码/2FA），敏感数据默认脱敏 ●●●●●●。
- 双主题 light/dark，含"深色模式 / 大字体模式(Senior +2pt) / 账号脱敏"全局开关。
- 底部 TabBar 4 项：库 / 健康 / 生成 / 设置。解锁/引导/恢复类为独立全屏布局。
- 复制密码后提示"60s 后清除剪贴板"。
- _11 截图实为新增密码表单（与 _9 重复），"生物识别解锁首页"按任务文字描述自行设计。
