# 🔐 SafeVault · 密码安全助手

> 零知识架构的移动端密码管理应用 —— 你的密码，只有你知道。

SafeVault 是一款基于**零知识架构**设计的密码安全管理 App，服务端永不接触明文密码与库数据。采用端到端加密（AES-256-GCM + PBKDF2/Argon2id），支持云账户认证、加密备份、恢复码体系、密码健康检测与生物识别解锁。

## ✨ 核心特性

| 特性 | 说明 |
| --- | --- |
| 🔑 零知识架构 | 服务端只存密文与密码验证器，永不接触明文密码 / 库数据 |
| 🔐 端到端加密 | AES-256-GCM 加密 + PBKDF2/Argon2id 密钥派生 + Sealed-Box 认证封装 |
| ☁️ 加密云备份 | 整库密文快照上传至 S3 兼容存储（MinIO / R2 / B2），覆盖式更新 |
| 🔄 恢复码体系 | 恢复码包裹 DataKey，主密码遗忘后可解密恢复全部数据 |
| 🛡️ 密码健康检测 | 弱密码、重复密码、过期密码一键扫描，安全评分可视化 |
| 🎲 密码生成器 | 可配置长度、字符类型、最小字符集保证，一键生成强密码 |
| 👆 生物识别 | 指纹 / 面容解锁，真机系统级生物识别 + 浏览器 Mock 回退 |
| 📱 跨平台 | Web H5 + Android APK（Capacitor / uni-app 双工程） |
| ⏱️ 自动锁定 | 可配置超时自动锁定，剪贴板 60 秒自动清除 |
| 🎨 像素级还原 | 严格对齐 Figma 设计稿，设计 Token 集中管理 |

## 🏗️ 项目结构

```
safevault/
├── safevault/          # 🐍 Python 后端（FastAPI）
│   ├── app/            #   源码：API / 模型 / 服务 / 消费者
│   ├── db/             #   数据库建表脚本与 Schema
│   ├── nginx/          #   Nginx 反向代理配置
│   ├── Dockerfile      #   多阶段构建
│   └── docker-compose.yml  # 全栈编排（MySQL/Redis/RabbitMQ/MinIO/API/Worker/Nginx）
│
├── safevault_ui/       # 🖥️ Vue 3 前端（Web + Android APK via Capacitor）
│   ├── src/
│   │   ├── views/      #   14 个功能模块，42 个 Vue 组件
│   │   ├── stores/     #   5 个 Pinia Store（cloudAccount/vault/generator/health/settings）
│   │   ├── composables/#   23 个组合式函数
│   │   ├── services/   #   9 个平台能力封装（crypto/http/biometric/clipboard...）
│   │   └── styles/     #   设计 Token（variables.scss）+ Mixins
│   ├── build-apk.sh    #   APK 打包脚本（JDK 21 + Android SDK）
│   └── capacitor.config.json
│
├── safevault_app/      # 📱 uni-app 工程（App Android/iOS + H5）
│   ├── pages/          #   13 个页面路由
│   ├── stores/         #   5 个 Pinia Store
│   ├── composables/    #   20 个组合式函数
│   ├── services/       #   9 个平台能力封装（含 @noble 原生加密）
│   └── utils/          #   12 个工具函数（加密/导航/守卫...）
│
├── PRD/                # 📋 产品需求文档
├── DRD/                # 🎨 交互与界面设计文档
├── SDD/                # 🏛️ 系统设计文档（时序图 / 模块与接口设计）
├── SID/                # 🚀 系统安装部署文档
├── SA/                 # 📢 销售与市场推广素材
├── BP/                 # 💼 商业计划（路演 PPT）
├── SOP/                # 📖 标准操作手册
├── STP/                # 🧪 软件测试计划
└── STR/                # 📊 软件测试报告
```

## 🛠️ 技术栈

### 后端（`safevault/`）

| 技术 | 用途 |
| --- | --- |
| **Python 3.13** + FastAPI | Web 框架与 API 服务 |
| **MySQL 8** (SQLAlchemy 2.0 异步 + asyncmy) | 主库：云账户 / 加密备份 / 恢复凭据 |
| **Redis 7** | 验证码 / 冷却 / 限流 / Refresh Token 白名单 |
| **RabbitMQ 3** (aio-pika) | 发码任务异步投递 |
| **MinIO** (S3 兼容) | 加密备份 Blob 对象存储 |
| **Brevo** | 事务邮件 HTTP API |
| **PyJWT** (HS256) | Access Token (15min) + Refresh Token (30d) |
| **cryptography** | X25519 ECDH + HKDF + AES-256-GCM Sealed-Box 认证 |
| **uv** | Python 工程与依赖管理 |

### 前端 — Vue 3 工程（`safevault_ui/`）

| 技术 | 用途 |
| --- | --- |
| **Vue 3** (Composition API, `<script setup>`) | 纯 JavaScript，非 TypeScript |
| **Vite 5** | 构建工具 |
| **Vue Router 4** | 路由（20 条路由，含全屏 / Tab / Sheet 弹出三类布局） |
| **Pinia** | 状态管理（5 个 Store） |
| **Sass / SCSS** | 设计 Token + BEM，全局注入 `variables.scss` + `mixins.scss` |
| **Element Plus** | 按需自动导入（仅 `ElMessage` / `ElMessageBox` / `ElInput` 等） |
| **Capacitor 8** | Android 壳，出调试/正式 APK |
| **Web Crypto API** | 客户端加密（AES-GCM / PBKDF2） |

### 前端 — uni-app 工程（`safevault_app/`）

| 技术 | 用途 |
| --- | --- |
| **uni-app 3.0** (DCloudio) | App (Android/iOS) + H5 双端发布 |
| **Vue 3** + Pinia | 状态管理 |
| **@noble/ciphers** + **@noble/curves** + **@noble/hashes** | 原生加密（替代 Web Crypto API） |
| **Sass** | 样式系统（与 safevault_ui 共享 Token 体系） |
| **Vitest** + **Playwright** | 加密一致性测试 + E2E 测试 |

## 🚀 快速开始

### 前提条件

- **Node.js** ≥ 18（前端）
- **Python** ≥ 3.13（后端）
- **uv** — [安装](https://docs.astral.sh/uv/)：`curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Docker** + Docker Compose（后端基础设施）
- **JDK 21** + **Android SDK**（仅 APK 打包需要）

### 1. 后端

```bash
cd safevault

# 安装依赖
uv sync

# 起基础设施（MySQL + Redis + RabbitMQ + MinIO）
docker compose up -d

# 建表（首次）
cd app && uv run python -m core.db.init_db

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 Brevo API Key 与发件邮箱；生产务必覆盖 JWT_SECRET

# 启动 API 服务
uv run uvicorn main:app --reload --port 8000

# 启动邮件消费者（另一终端）
uv run python -m comsumer.mail
```

API 文档：http://localhost:8000/docs

### 2. 前端（Vue 3 工程）

```bash
cd safevault_ui

npm install
npm run dev
```

开发服务器启动在 http://localhost:5180/ ，自动重定向到解锁页。

> 桌面浏览器以 390px 移动端画布居中预览；建议用 DevTools 切换到移动设备视图。

### 3. 前端（uni-app 工程）

```bash
cd safevault_app

npm install

# H5 开发
npm run dev:h5

# App 开发（需 HBuilderX 或 Android Studio）
npm run dev:app

# 加密一致性测试
npm run test:crypto
```

### 4. Android APK 打包（Vue 3 工程）

```bash
cd safevault_ui

npm run apk          # 调试版 APK（产物归档到 apk-output/）
npm run apk:install  # 调试版 + USB 安装启动
npm run apk:release  # 正式版（需配置 KEYSTORE_PATH 等环境变量）
```

### 5. 全栈 Docker 部署

```bash
cd safevault

# 配置环境变量
cp .env.example .env
# 编辑 .env

# 全栈一键部署（MySQL + Redis + RabbitMQ + MinIO + API + Worker + Nginx）
docker compose up -d --build
```

部署完成后 Nginx 监听 **80** 端口，`/safevault/` 代理至 API，`/` 提供前端静态页。

## 🔐 安全架构

### 零知识原则

```
用户主密码 → PBKDF2/Argon2id → MasterKey
                                    ├── DataKey (包裹后存储于 backup_blob)
                                    └── Sealed-Box → Password Verifier → 服务端

服务端存储：
  ✅ server_salt + password_verifier（叠加 server_salt 慢哈希后的验证器）
  ✅ wrapped_data_key（密码/恢复码包裹的 DataKey）
  ✅ kdf_params（KDF 配置，仅透传）
  ❌ 不存储明文密码
  ❌ 不存储 MasterKey / DataKey
  ❌ 不解析加密 Blob 内容
```

### 数据库表

| 表 | 说明 |
| --- | --- |
| `account` | 云账户：email + server_salt + password_verifier + kdf_params + token_version |
| `backup_blob` | 加密备份：密文指向 S3 对象 + wrapped_data_key + version + checksum |
| `recovery_blob` | 恢复凭据：恢复码包裹的 DataKey + kdf_params |

### JWT 认证

- **Access Token**：15 分钟有效期，HS256 签名
- **Refresh Token**：30 天有效期，Redis 白名单管理，支持即时吊销（token_version）
- **限流**：Redis 滑动窗口，按 IP / Email 维度

## 📱 功能截图

| 解锁页 | 密码库 | 密码健康 | 密码生成器 |
|:---:|:---:|:---:|:---:|
| 生物识别 / 主密码解锁 | 分类筛选 / 搜索 | 安全评分 / 弱密码检测 | 可配置长度与字符集 |

## 📄 文档索引

| 文档 | 路径 |
| --- | --- |
| 产品需求文档 (PRD) | [`PRD/SafeValut产品需求 v1.0.md`](PRD/) |
| 交互与界面设计 (DRD) | [`DRD/SafeValut交互与界面设计 v1.0.md`](DRD/) |
| 模块 1 时序图 — 云账户与认证 | [`SDD/SafeVault模块1-云账户与认证-时序图 v1.0.md`](SDD/) |
| 模块 2 时序图 — 加密备份 Blob | [`SDD/SafeVault模块2-加密备份blob存储-时序图 v1.0.md`](SDD/) |
| 模块与接口设计 | [`SDD/SafeVault模块和接口设计 v1.0.md`](SDD/) |
| 快速部署文档 | [`SID/SafeVault快速部署文档 v1.0.md`](SID/) |
| 微信公众号推广方案 | [`SA/微信公众号推广方案.md`](SA/) |

## 📜 许可证

私有项目，未开放源代码许可。
