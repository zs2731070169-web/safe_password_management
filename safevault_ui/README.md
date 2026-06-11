# SafeVault · 安全密库（前端）

基于 Figma 设计稿「启动/解锁页」像素级还原的移动端前端工程。

## 技术栈

- Vue 3（Composition API，`<script setup>`）
- Vite 5
- Element Plus（按需自动导入）
- Pinia（状态管理）
- Sass / SCSS（设计 Token + BEM）
- Vue Router 4

## 快速开始

```bash
cd safevault_ui
npm install
npm run dev
```

默认启动在 http://localhost:5180/ ，自动打开浏览器并重定向到 `/unlock` 解锁页。

> 桌面浏览器中页面以 390px 移动端画布居中预览；建议用浏览器 DevTools 切换到移动设备视图查看最佳效果。

## 目录结构

```
src/
├── main.js                      # 应用入口
├── App.vue                      # 根组件（移动端画布容器）
├── router/                      # 路由表
├── stores/                      # Pinia store
│   └── auth.js                  # 认证/解锁状态（含 mock 解锁流程）
├── composables/                 # 组合式函数
│   └── useUnlock.js             # 解锁交互编排（loading/反馈/取消）
├── components/
│   └── icons/                   # 通用图标组件
│       ├── AppIcon.vue          # 矢量图标渲染器（currentColor 透传）
│       └── icon-paths.js        # 图标路径注册表（来源 Figma）
├── views/
│   └── unlock/                  # 解锁页模块
│       ├── UnlockView.vue       # 解锁页主视图
│       └── components/          # 解锁页私有子组件
│           ├── AppHeader.vue        # 顶部品牌导航
│           ├── BrandIdentity.vue    # 品牌徽标 + 标题
│           ├── BiometricButton.vue  # 88dp 生物识别按钮
│           └── TrustBadge.vue       # 底部信任徽章
└── styles/
    ├── variables.scss           # 设计 Token（颜色/字体/间距/圆角/阴影）
    ├── mixins.scss              # 复用 SCSS 工具
    └── index.scss               # 全局 reset + 字体
```

## 解锁交互（当前为前端 mock）

- 点击指纹按钮：模拟生物识别，约 1.2s 后解锁成功。
- 「使用主密码解锁」：弹窗输入主密码，默认正确主密码为 `123456`。
- 「忘记主密码？」：弹出安全说明占位提示。

真实接入时只需替换 `stores/auth.js` 中的 mock 实现，视图与组合式函数无需改动。

## 设计来源

- Figma：白君's team library / 启动·解锁页（node `3312:925`）
- 所有颜色、字号、间距、圆角、阴影均提取自设计稿，集中维护于 `src/styles/variables.scss`，业务样式禁止硬编码。
