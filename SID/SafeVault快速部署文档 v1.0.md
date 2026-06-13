# SafeVault 快速部署文档 v1.0

> **适用环境**：Ubuntu 服务器（云主机），IP `165.154.235.11`，用户 `ubuntu`
> **部署方式**：全栈 Docker Compose（API + 邮件消费者 + Nginx + MySQL + Redis + RabbitMQ + MinIO）
> **宿主机仅需**：Docker + Docker Compose + Node.js（前端构建）+ Git

---

## 目录

1. [服务器基础环境](#1-服务器基础环境)
2. [拉取代码与配置](#2-拉取代码与配置)
3. [环境变量配置](#3-环境变量配置)
4. [构建与启动服务](#4-构建与启动服务)
5. [初始化数据库与 MinIO](#5-初始化数据库与-minio)
6. [前端 H5 构建与部署](#6-前端-h5-构建与部署)
7. [Android APK 打包](#7-android-apk-打包)
8. [运维与排障](#8-运维与排障)
9. [凭据清单](#9-凭据清单)

---

## 1. 服务器基础环境

### 1.1 SSH 登录

```bash
ssh ubuntu@165.154.235.11
# 密码登录（首次登录后建议配置 SSH 密钥，见下方安全加固）
```

### 1.2 系统更新与基础工具

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget vim unzip
```

### 1.3 安装 Docker 与 Docker Compose

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# 重新登录使 docker 组生效
exit
ssh ubuntu@165.154.235.11

# 验证
docker --version
docker compose version
```

### 1.4 安装 Node.js（前端 H5 构建用）

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node --version
npm --version
```

> 💡 Node.js 仅用于构建前端 H5 静态文件，后端 API 和邮件消费者完全运行在 Docker 容器内，宿主机无需安装 Python、uv 或 Nginx。

### 1.5 安全加固（强烈建议）

```bash
# ① 配置 SSH 密钥登录（禁用密码登录）
# 在本地电脑执行：
ssh-keygen -t ed25519
ssh-copy-id ubuntu@165.154.235.11

# 在服务器上禁用密码登录：
sudo vim /etc/ssh/sshd_config
# 修改 PasswordAuthentication no
sudo systemctl restart sshd

# ② 配置防火墙
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 2. 拉取代码与配置

### 2.1 拉取代码

```bash
cd ~
git clone https://github.com/zs2731070169-web/safe_password_management.git safevault
cd safevault/safevault
```

### 2.2 项目结构说明

```
safevault/safevault/
├── Dockerfile              # 后端应用镜像（API + Worker 共用）
├── docker-compose.yml      # 全栈编排：基础设施 + 应用 + Nginx
├── .env.example            # 环境变量示例
├── pyproject.toml          # Python 依赖声明
├── nginx/
│   └── default.conf        # Nginx 反向代理配置（Docker 内挂载）
├── dist/
│   └── h5/                 # 前端 H5 构建产物（部署时填入）
└── app/                    # 后端源码
    ├── main.py             # FastAPI 入口
    └── comsumer/mail.py    # 邮件消费者
```

### 2.3 创建必要目录

```bash
mkdir -p dist/h5
```

---

## 3. 环境变量配置

### 3.1 创建 .env 文件

```bash
cp .env.example .env
vim .env
```

### 3.2 必须修改的变量

> ⚠️ 以下列出的变量**必须在 .env 中填入真实值**，切勿沿用开发默认值。
>
> **连接地址无需修改**：`DATABASE_URL`、`REDIS_URL`、`RABBITMQ_URL`、`OSS_ENDPOINT` 这四项
> 已在 `docker-compose.yml` 的 `environment:` 中覆盖为 Docker 内部服务名，.env 中的值会被忽略。
> 只需关注以下变量：

```bash
# ---------- 基础设施密码（Docker Compose 变量替换用）----------
# 以下密码同时用于基础设施容器初始化和 docker-compose.yml 中的连接地址替换
MYSQL_ROOT_PASSWORD=<你的MySQL root密码>       # 生产必须替换默认值 root
MYSQL_PASSWORD=<你的MySQL应用密码>              # 生产必须替换默认值 safevault
REDIS_PASSWORD=<你的Redis密码>                  # 生产必须替换默认值 safevault
RABBITMQ_DEFAULT_USER=<你的RabbitMQ用户>        # 生产必须替换默认值 guest
RABBITMQ_DEFAULT_PASS=<你的RabbitMQ密码>        # 生产必须替换默认值 guest
MINIO_ROOT_USER=<你的MinIO用户>                 # 生产必须替换默认值 minioadmin
MINIO_ROOT_PASSWORD=<你的MinIO密码>             # 生产必须替换默认值 minioadmin

# ---------- JWT（⚠️ 生产必须覆盖！）----------
JWT_SECRET=<用 openssl rand -hex 32 生成>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30

# ---------- 认证非对称封装私钥（⚠️ 生产必须覆盖！）----------
# 生成新密钥：python3 -c "from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey; import base64; print(base64.b64encode(X25519PrivateKey.generate().private_bytes_raw()).decode())"
SEAL_PRIVATE_KEY=<新生成的X25519私钥base64>

# ---------- Brevo 邮件 ----------
BREVO_API_KEY=<你的Brevo v3 API Key>
BREVO_SENDER_EMAIL=<你验证过的发件邮箱>
BREVO_SENDER_NAME=SafeVault
MAIL_PROXY=    # 服务器直连 Brevo，留空

# ---------- S3 兼容对象存储 ----------
# OSS_ENDPOINT 已由 docker-compose.yml 覆盖为 http://minio:9000，无需在 .env 设置
OSS_REGION=us-east-1
OSS_BUCKET=safevault
OSS_ACCESS_KEY_ID=${MINIO_ROOT_USER}          # 与上方 MinIO 用户一致
OSS_ACCESS_KEY_SECRET=${MINIO_ROOT_PASSWORD}   # 与上方 MinIO 密码一致
OSS_KEY_PREFIX=backup

# ---------- CORS ----------
# 生产环境收紧为前端实际域名
CORS_ALLOW_ORIGINS=http://165.154.235.11,http://165.154.235.11:80
```

### 3.3 Docker 连接地址覆盖机制说明

`docker-compose.yml` 中 `api` 和 `worker` 服务的 `environment:` 段已将四项连接地址
硬编码为 Docker 内部服务名：

| 变量 | Docker 内值 | 说明 |
|------|------------|------|
| `DATABASE_URL` | `mysql+asyncmy://safevault:${MYSQL_PASSWORD}@mysql:3306/safevault` | `mysql` 是 Docker 服务名 |
| `REDIS_URL` | `redis://:${REDIS_PASSWORD}@redis:6379/0` | `redis` 是 Docker 服务名 |
| `RABBITMQ_URL` | `amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:5672/` | `rabbitmq` 是 Docker 服务名 |
| `OSS_ENDPOINT` | `http://minio:9000` | `minio` 是 Docker 服务名 |

> `environment:` 中的值优先级高于 `env_file: .env`，因此 .env 中的 `localhost` 地址会被自动覆盖，无需手动修改。

---

## 4. 构建与启动服务

### 4.1 一键构建与启动

```bash
cd ~/safevault/safevault

# 构建后端镜像并启动全部服务
docker compose up -d --build
```

### 4.2 检查服务状态

```bash
docker compose ps

# 预期输出：7 个容器全部 Up (healthy)
#   safevault-mysql     running (healthy)
#   safevault-redis     running
#   safevault-rabbitmq  running
#   safevault-minio     running
#   safevault-api       running (healthy)
#   safevault-worker    running
#   safevault-nginx     running
```

### 4.3 查看日志

```bash
# API 服务日志
docker compose logs api -f

# 邮件消费者日志
docker compose logs worker -f

# 全部服务日志
docker compose logs -f
```

### 4.4 单独启动基础设施（开发模式）

如需在宿主机运行后端进行本地调试，可仅启动基础设施：

```bash
docker compose up -d mysql redis rabbitmq minio
```

---

## 5. 初始化数据库与 MinIO

### 5.1 初始化 MySQL 数据库

```bash
# 在 API 容器内执行建表脚本
docker compose exec api python -m core.base.init_db

# 备用方式：手动执行 SQL
docker compose exec -i mysql mysql -uroot -p"<你的MySQL root密码>" safevault < db/schema.sql
```

### 5.2 初始化 MinIO Bucket

```bash
# 安装 mc 客户端（宿主机一次性操作）
wget https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc
sudo mv mc /usr/local/bin/

# 配置 MinIO 别名（连接宿主机映射端口）
mc alias set safevault http://127.0.0.1:9000 <你的MinIO用户> <你的MinIO密码>

# 创建 bucket
mc mb safevault/safevault

# 验证
mc ls safevault
```

> 💡 MinIO 的 9000 端口已映射到宿主机，mc 可直接通过 `127.0.0.1:9000` 访问。

### 5.3 验证后端

```bash
# 通过 Nginx 代理访问健康检查
curl http://127.0.0.1/health
# 预期：{"status":"ok"}

# 直接访问 API 容器（需先在 docker-compose.yml 取消 api 的 ports 注释）
# curl http://127.0.0.1:8000/health
```

---

## 6. 前端 H5 构建与部署

### 6.1 修改前端 API 地址

编辑 `safevault_app/.env`，将 API 地址指向服务器：

```bash
# 生产环境 API 地址（走 Nginx 代理，80 端口）
VITE_APP_DEV_API_BASE=http://165.154.235.11
```

> Nginx 已将 `/safevault/*` 代理到后端 API 容器，前端只需请求 `http://165.154.235.11/safevault/...`。

### 6.2 构建前端

```bash
cd ~/safevault/safevault_app
npm install
npm run build:h5
```

构建产物在 `dist/build/h5/` 目录。

### 6.3 复制到 Nginx 挂载目录

```bash
# 将构建产物复制到 Docker 部署目录
cp -r ~/safevault/safevault_app/dist/build/h5/* ~/safevault/safevault/dist/h5/
```

Nginx 容器已通过 volume 挂载 `./dist/h5` → `/var/www/safevault`，复制完成后自动生效，无需重启。

### 6.4 验证

浏览器访问 `http://165.154.235.11`，应看到 SafeVault 解锁页面。

---

## 7. Android APK 打包

> ⚠️ APK 打包需要在 **本地开发机**（macOS/Windows）上使用 HBuilderX 完成，
> 无法在服务器上自动化。以下为手动操作步骤。

### 7.1 前提条件

- 已安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（推荐最新正式版）
- 已注册 DCloud 开发者账号（HBuilderX 登录用）
- 准备 Android 签名证书（发布版需要；调试版 HBuilderX 可自动生成）

### 7.2 修改 API 地址

打包前，确保 `safevault_app/.env` 中 API 地址指向生产服务器：

```
VITE_APP_DEV_API_BASE=http://165.154.235.11
```

### 7.3 HBuilderX 云打包步骤

1. **打开工程**：HBuilderX → 文件 → 打开目录 → 选择 `safevault_app/`
2. **检查 manifest.json**：
   - 确保 `appid` 已填写（当前：`__UNI__666A11F`）
   - 确保 Android 权限配置正确
   - 在「App 模块配置」中确认所需模块已勾选
3. **发起打包**：
   - 菜单栏 → 发行 → 原生 App-云打包
   - 选择 **Android**
   - 选择打包类型：
     - **使用公共测试证书** → 调试版（快速验证，不可上架）
     - **使用自有证书** → 发布版（需要 .keystore 签名文件）
4. **等待打包完成**：云打包通常 2-5 分钟，完成后自动下载 APK 到 `unpackage/apk/` 目录
5. **安装测试**：
   - 将 APK 传到手机安装测试
   - 或通过 `adb install <apk文件>` 安装到已连接的 Android 设备

### 7.4 生成 Android 签名证书（发布版）

如需上架应用商店，须使用自有证书：

```bash
# 在本地 Mac 终端执行
keytool -genkey -alias safevault -keyalg RSA -keysize 2048 -validity 36500 \
  -keystore safevault-release.keystore \
  -storepass <你的keystore密码> \
  -keypass <你的key密码> \
  -dname "CN=SafeVault, OU=SafeVault, O=SafeVault, L=Beijing, ST=Beijing, C=CN"
```

在 HBuilderX 云打包时选择此 `.keystore` 文件并填入对应密码。

### 7.5 备用方案：safevault_ui Capacitor 打包

如需使用原 `safevault_ui/` 工程打包（Capacitor 方式）：

```bash
cd ~/safevault/safevault_ui  # 在本地 Mac 上
npm install
npm run apk          # 调试版 APK，产物归档到 apk-output/
npm run apk:install  # 打包 + USB 安装 + 启动
```

> 要求本地 JDK 21 + Android SDK。`build-apk.sh` 会自动探测 Android Studio 自带的 JBR 与 SDK 路径。

---

## 8. 运维与排障

### 8.1 常用命令速查

```bash
# ---------- 服务管理 ----------
docker compose ps                              # 全部容器状态
docker compose restart api                     # 重启 API 服务
docker compose restart worker                  # 重启邮件 Worker
docker compose logs api -f --tail 100          # API 实时日志（最近 100 行）
docker compose logs worker -f --tail 100       # Worker 实时日志

# ---------- 重新构建（代码更新后）----------
docker compose up -d --build api worker        # 仅重建应用服务
docker compose up -d --build                   # 重建全部（含基础设施，通常不需要）

# ---------- 基础设施 ----------
docker compose logs mysql --tail 50            # MySQL 日志
docker compose restart redis                   # 重启 Redis

# ---------- MySQL ----------
docker compose exec mysql mysql -uroot -p"<密码>" safevault

# ---------- Redis ----------
docker compose exec redis redis-cli -a "<密码>"

# ---------- RabbitMQ 管理台 ----------
# 浏览器访问 http://165.154.235.11:15672
# 注意：15672 端口需在防火墙放行，或通过 SSH 隧道访问

# ---------- MinIO 控制台 ----------
# 浏览器访问 http://165.154.235.11:9001
# 同上，9001 端口需放行或隧道

# ---------- Nginx ----------
docker compose exec nginx nginx -t             # 检查配置
docker compose exec nginx nginx -s reload      # 重载配置
docker compose logs nginx --tail 50            # Nginx 日志
```

### 8.2 常见问题

| 问题 | 排查方向 |
|------|----------|
| API 返回 `502 Bad Gateway` | API 容器未就绪：`docker compose ps api`；健康检查失败：`docker compose logs api` |
| 注册/登录报 `500` | 数据库连接失败：检查 `.env` 的 `MYSQL_PASSWORD` 与 MySQL 容器状态 |
| 验证码收不到邮件 | 检查 Worker 日志 `docker compose logs worker`；确认 Brevo API Key 有效 |
| H5 页面空白 | 检查 `dist/h5/` 目录是否有构建产物；Nginx 日志：`docker compose logs nginx` |
| APK 打包失败 | 检查 HBuilderX 版本；确认 `manifest.json` 格式正确；查看 HBuilderX 控制台错误 |
| 备份上传 `413` | Nginx `client_max_body_size` 过小，修改 `nginx/default.conf` 后 `docker compose exec nginx nginx -s reload` |
| 备份上传 `504` | 后端处理超时，调大 `nginx/default.conf` 中 `proxy_read_timeout` |
| 容器启动失败 | `docker compose logs <服务名>` 查看详细错误 |
| API 容器健康检查失败 | `docker compose logs api` 查看启动日志；确认 MySQL 容器已 healthy |

### 8.3 更新部署

```bash
cd ~/safevault
git pull origin main

# ---------- 后端更新（重新构建镜像）----------
cd safevault
docker compose up -d --build api worker

# ---------- 前端 H5 更新 ----------
cd ~/safevault/safevault_app
npm install                       # 更新依赖（如有变更）
npm run build:h5                  # 重新构建
cp -r dist/build/h5/* ~/safevault/safevault/dist/h5/

# ---------- 数据库迁移 ----------
# 如有表结构变更，在 API 容器内执行：
docker compose exec api python -m core.base.init_db
# 注意：create_all 不会 ALTER 已有表，需按 db/schema.sql 手动变更或重建
```

### 8.4 数据备份

```bash
# MySQL 全库备份
docker compose exec mysql mysqldump -uroot -p"<密码>" safevault \
  | gzip > ~/backup/safevault-$(date +%Y%m%d).sql.gz

# Redis RDB 快照（容器内自动持久化到卷）
docker compose exec redis redis-cli -a "<密码>" BGSAVE

# MinIO 数据备份
mc mirror safevault/safevault ~/backup/minio-$(date +%Y%m%d)/
```

建议配合 `crontab` 设置每日自动备份：

```bash
# 每天凌晨 3 点备份
0 3 * * * cd /home/ubuntu/safevault/safevault && docker compose exec -T mysql mysqldump -uroot -p"<密码>" safevault | gzip > /home/ubuntu/backup/safevault-$(date +\%Y\%m\%d).sql.gz
```

### 8.5 清理与重置

```bash
# 停止并删除全部容器（数据卷保留）
docker compose down

# 停止并删除全部容器 + 数据卷（⚠️ 数据全部清除）
docker compose down -v

# 清理未使用的 Docker 镜像
docker image prune -f
```

---

## 9. 凭据清单

> ⚠️ 以下为部署所需的凭据汇总。**切勿将真实密码提交到 Git 仓库**。
> 建议使用密码管理器保存，或存于服务器上权限受限的文件中（`chmod 600`）。

| 凭据项 | 变量/位置 | 值 | 备注 |
|--------|-----------|-----|------|
| SSH 登录 | 服务器 22 端口 | `ubuntu` / `<密码>` | 建议改用密钥登录 |
| MySQL root | `MYSQL_ROOT_PASSWORD` | `<密码>` | .env |
| MySQL 应用用户 | `MYSQL_PASSWORD` | `safevault` / `<密码>` | .env + docker-compose.yml |
| Redis | `REDIS_PASSWORD` | `<密码>` | .env + docker-compose.yml |
| RabbitMQ | `RABBITMQ_DEFAULT_USER/PASS` | `<用户>` / `<密码>` | .env + docker-compose.yml |
| RabbitMQ 管理台 | http://IP:15672 | 同上 | 开发调试用 |
| MinIO | `MINIO_ROOT_USER/PASSWORD` | `<用户>` / `<密码>` | .env + docker-compose.yml |
| MinIO 控制台 | http://IP:9001 | 同上 | 开发调试用 |
| JWT 签名密钥 | `JWT_SECRET` | `openssl rand -hex 32` 生成 | **生产必须覆盖** |
| X25519 封装私钥 | `SEAL_PRIVATE_KEY` | 见 .env.example 说明生成 | **生产必须覆盖** |
| Brevo API Key | `BREVO_API_KEY` | Brevo 后台获取 | 邮件发送必需 |
| Brevo 发件邮箱 | `BREVO_SENDER_EMAIL` | 已验证的邮箱 | 邮件发送必需 |

---

## 附录 A：一键部署脚本（快速版）

> 以下脚本适用于全新 Ubuntu 22.04/24.04 服务器，从零搭建到全栈可用。
> **使用前务必替换所有 `<占位符>` 为真实值。**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# SafeVault 一键部署脚本（Docker 全栈版）
# 使用：chmod +x deploy.sh && ./deploy.sh
# ============================================================

echo "===== 1. 系统更新与基础工具 ====="
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget vim unzip

echo "===== 2. Docker ====="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker ubuntu
  echo "⚠️ Docker 已安装，请重新登录使组生效后再次运行此脚本"
  exit 0
fi

echo "===== 3. Node.js（前端构建用）====="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "===== 4. 拉取代码 ====="
cd ~
if [ ! -d ~/safevault ]; then
  git clone <你的仓库地址> safevault
fi
cd ~/safevault/safevault
mkdir -p dist/h5

echo "===== 5. 配置 .env ====="
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️ 请编辑 ~/safevault/safevault/.env 填入真实配置后重新运行"
  echo "   必须修改：MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD / REDIS_PASSWORD"
  echo "             RABBITMQ_DEFAULT_USER / RABBITMQ_DEFAULT_PASS"
  echo "             MINIO_ROOT_USER / MINIO_ROOT_PASSWORD"
  echo "             JWT_SECRET / SEAL_PRIVATE_KEY"
  echo "             BREVO_API_KEY / BREVO_SENDER_EMAIL"
  exit 0
fi

echo "===== 6. 构建与启动 Docker 容器 ====="
docker compose up -d --build

echo "等待 MySQL 就绪..."
sleep 10

echo "===== 7. 初始化数据库 ====="
docker compose exec api python -m core.base.init_db

echo "===== 8. 初始化 MinIO Bucket ====="
if ! command -v mc &>/dev/null; then
  wget -q https://dl.min.io/client/mc/release/linux-amd64/mc
  chmod +x mc
  sudo mv mc /usr/local/bin/
fi
# ⚠️ 请替换为你的 MinIO 用户和密码
mc alias set safevault http://127.0.0.1:9000 minioadmin minioadmin 2>/dev/null || true
mc mb safevault/safevault 2>/dev/null || echo "Bucket 已存在，跳过"

echo "===== 9. 构建前端 H5 ====="
cd ~/safevault/safevault_app
npm install
npm run build:h5
cp -r dist/build/h5/* ~/safevault/safevault/dist/h5/

echo ""
echo "✅ 部署完成！"
echo "   后端健康检查：curl http://165.154.235.11/health"
echo "   Swagger 文档：http://165.154.235.11/docs"
echo "   前端 H5：http://165.154.235.11"
echo ""
echo "⚠️ APK 打包请在本地 Mac 上用 HBuilderX 完成（见部署文档第 7 节）"
```

---

## 附录 B：端口映射总览

| 端口 | 服务 | 对外暴露 | 说明 |
|------|------|----------|------|
| 80 | Nginx | ✅ | 前端 H5 + API 反向代理（唯一对外入口） |
| 3306 | MySQL | 按需 | 容器内；映射到宿主机供调试，生产可移除 |
| 5672 | RabbitMQ AMQP | ❌ | 容器内，仅 Docker 网络访问 |
| 6379 | Redis | 按需 | 容器内；映射到宿主机供调试，生产可移除 |
| 8000 | FastAPI (uvicorn) | ❌ | 容器内，通过 Nginx 代理访问 |
| 9000 | MinIO S3 API | 按需 | 容器内；映射到宿主机供 mc 初始化 |
| 9001 | MinIO 控制台 | 按需 | 管理调试用 |
| 15672 | RabbitMQ 管理台 | 按需 | 管理调试用 |

> 生产环境建议：
> 1. 仅保留 Nginx 的 80 端口对外暴露
> 2. 在 `docker-compose.yml` 中移除 MySQL（3306）、Redis（6379）的 `ports` 映射
> 3. 管理端口（15672、9001）通过 SSH 隧道访问，不直接暴露：
>    ```bash
>    # 本地电脑执行，建立隧道
>    ssh -L 15672:127.0.0.1:15672 -L 9001:127.0.0.1:9001 ubuntu@165.154.235.11
>    # 然后本地浏览器访问 http://localhost:15672（RabbitMQ）和 http://localhost:9001（MinIO）
>    ```

---

## 附录 C：Docker Compose 架构图

```
                    ┌─────────────────────────────────────────────────┐
                    │              Ubuntu 服务器 (165.154.235.11)      │
                    │                                                 │
  :80 ───────────► │  ┌──────────┐   ┌──────────┐                   │
                    │  │  nginx   │──►│   api    │──► mysql ◄──┐     │
                    │  │  :80     │   │  :8000   │──► redis     │     │
                    │  └──────────┘   └────┬─────┘──► rabbitmq  │     │
                    │       ▲             │           ┌─────┐   │     │
                    │       │             │           │worker│──►┘     │
                    │       │             │           │(mail)│──►minio │
                    │  dist/h5/           │           └─────┘         │
                    │  (前端静态文件)       │                           │
                    │                     └── Docker 内部网络         │
                    └─────────────────────────────────────────────────┘
```
