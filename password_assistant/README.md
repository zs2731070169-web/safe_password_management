# SafeVault 后端（认证服务）

SafeVault「模块 1：云账户与认证」的 Python 后端，当前实现 **§1 下发邮箱验证码** `POST /auth/verify-code`。
对齐 `SDD/SafeVault模块1-云账户与认证-时序图 v1.0.md`。

## 技术栈

- **uv** — Python 工程与依赖管理（`pyproject.toml` + `uv.lock`）
- **FastAPI** + Uvicorn — Web 框架
- **MySQL 8**（SQLAlchemy 2.0 异步 ORM + asyncmy）— 主库：云账户/认证、加密备份 blob、恢复凭据
- **Redis** — 验证码（TTL 300s）、发码冷却（60s）、滑动窗口限流
- **RabbitMQ**（aio-pika）— 发码任务异步投递，主链路不等邮件送达
- **阿里云邮件推送 DirectMail**（SingleSendMail）— 实际发信

## 数据库（MySQL）

按 `SDD/SafeVault模块和接口设计 v1.0.md` 落地，**全程零知识**：后端只存密文与密码验证器，永不接触明文密码 / 库数据。

| 表 | 对应模块 | 说明 |
| --- | --- | --- |
| `accounts` | 模块 1 云账户与认证 | 邮箱 + `password_verifier`（慢哈希身份验证器，**非** MasterKey） |
| `refresh_tokens` | 模块 1 | 刷新令牌（仅存 SHA-256 哈希、可吊销），支撑「会话不持久化、冷启动重登」 |
| `backups` | 模块 2 加密备份 blob（核心） | 每账户**一份**整库密文快照（覆盖式）：`ciphertext`(longblob, 永不解析) + `kdf_params`(json) + `version`(防回退) + `checksum` + `size_bytes`；`updated_at` 即「最后备份时间」 |
| `recovery_blobs` | 模块 3 决策点 C2（可选） | 恢复凭据包裹的 DataKey 密文（key escrow），仅采用 C2 时写入；建表保留以备启用 |

建表（幂等，未引入 Alembic，统一 `create_all`）：

```bash
cd app
uv run python -m db.init_db   # 连接 MySQL → 建 4 张表 → 退出
```

> 应用启动时 `main.py` 的 lifespan 也会连接 MySQL（不自动建表，首次需手动跑上面的脚本）。
> 演示重置：`docker compose down -v` 清库卷后，重新 `up -d` 并再跑一次建表脚本。

## 目录结构

```
app/
  main.py              # FastAPI 入口，lifespan 启停 MySQL/Redis/MQ
  config.py            # 环境变量配置（pydantic-settings）
  api/auth.py          # POST /auth/verify-code
  schemas/auth.py      # 请求/响应模型（EmailStr 校验）
  db/
    base.py            # 声明式 Base + 时间戳 Mixin
    session.py         # 异步引擎/会话（init/create_all/close）
    init_db.py         # 建表脚本：python -m db.init_db
  models/
    account.py         # accounts / refresh_tokens（模块1）
    backup.py          # backups（模块2 加密备份 blob）
    recovery.py        # recovery_blobs（模块3 C2 可选）
  client/
    redis_client.py    # Redis 异步连接
  services/
    rate_limit.py      # 滑动窗口限流（IP / email）
    verify_code.py     # 发码编排：冷却→生码→写码→投递 MQ
  core/
    exceptions.py      # 业务异常 + 处理器
    mq/
      producer.py      # RabbitMQ 生产者
      consumer.py      # 通用消费框架（连接/声明/解析/重试/确认）
  comsumer/
    mail.py            # 发码邮件消费者（独立进程，组装通用框架 + 发信 handler）
worker/
  aliyun_mail.py       # DirectMail 发信封装
pyproject.toml         # uv 工程定义与依赖
uv.lock                # 锁定的依赖版本（入库）
docker-compose.yml     # 本地 MySQL + Redis + RabbitMQ
```

## 快速开始

> 本工程用 [uv](https://docs.astral.sh/uv/) 管理依赖与虚拟环境。未安装 uv：`curl -LsSf https://astral.sh/uv/install.sh | sh`

### 1. 安装依赖

```bash
cd password_assistant
uv sync            # 按 uv.lock 创建 .venv 并安装全部依赖（含 dev）
# 生产部署可跳过 dev 依赖：uv sync --no-dev
```

### 2. 起基础设施（MySQL + Redis + RabbitMQ）

```bash
docker compose up -d
```

- MySQL：localhost:**3306**（safevault / safevault，库名 safevault）
- RabbitMQ 管理台：http://localhost:15672 （guest / guest）

> 起完容器后执行一次建表脚本（见上文「数据库」一节）：`cd app && uv run python -m db.init_db`

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入阿里云 AccessKey 与已验证的发信地址
```

关键变量：

| 变量 | 说明 |
| --- | --- |
| `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | 阿里云 AccessKey（建议 RAM 子账号） |
| `ALIYUN_DM_ACCOUNT_NAME` | 控制台「发信地址」中配置好的地址 |
| `ALIYUN_DM_FROM_ALIAS` | 发件人显示别名 |
| `CODE_TTL` / `COOLDOWN_TTL` | 验证码有效期 / 发码冷却（秒） |
| `RATE_LIMIT_*` | 限流窗口与阈值 |

### 4. 启动服务与消费者（两个终端）

> `app/` 是后端源码根，下面命令都在 `app/` 目录下执行（`cd app`），
> 这样 `main`、`worker.xxx` 等才能作为顶层模块被解析。

```bash
cd app

# 终端 A：API 服务（uv run 自动用工程 .venv，无需手动 activate）
uv run uvicorn main:app --reload --port 8000

# 终端 B：邮件消费者
uv run python -m comsumer.mail
```

> 本地 / 演示想少开一个终端：在 `.env` 设 `RUN_CONSUMER_INLINE=true`，
> 消费者会随 web 进程在 lifespan 内一起启动，无需终端 B。
> ⚠️ 生产环境保持独立进程，且切勿在 `uvicorn --workers N` / 多副本下开启内联，
> 否则消费者被复制成多份，重复消费同一队列。

```bash
```

API 文档（Swagger）：http://localhost:8000/docs

### 常用 uv 命令

```bash
uv add <pkg>           # 新增依赖（自动写入 pyproject.toml 并更新 uv.lock）
uv add --dev <pkg>     # 新增 dev 依赖
uv remove <pkg>        # 移除依赖
uv lock --upgrade      # 升级锁定版本
uv run <cmd>           # 在工程环境内执行命令
```

## 联调验证

```bash
# 正常发码 → 200 {"sent":true}
curl -i -X POST localhost:8000/auth/verify-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'

# Redis 中确认验证码已写入（应有值，TTL≈300）
redis-cli get code:you@example.com
redis-cli ttl  code:you@example.com
```

预期：

| 场景 | 结果 |
| --- | --- |
| 正常请求 | `200 {"sent":true}`，worker 日志显示发信，邮箱收到验证码 |
| 60s 内重复同邮箱 | `429 {"detail":"请稍后再试"}`（冷却） |
| 1 分钟内同邮箱第 6 次 | `429 {"detail":"请求过于频繁，请稍后再试"}`（限流） |
| 非法邮箱 `{"email":"bad"}` | `422`（pydantic 校验） |

> 邮件为异步旁路：即便阿里云未配置，API 仍立即返回 200，发信失败只在 worker 日志体现。

## 与时序图的对应

| 时序图步骤 | 实现位置 |
| --- | --- |
| 网关按 IP/email 滑动窗口限流 | `services/rate_limit.py` |
| 校验邮箱格式 | `schemas/auth.py`（`EmailStr`） |
| GET cooldown / 冷却拦截 | `services/verify_code.py` |
| 生成 6 位码 + SETEX code/cooldown | `services/verify_code.py` |
| 投递发码任务（MQ 异步） | `core/mq/producer.py` → `comsumer/mail.py`（基于 `core/mq/consumer.py`） |
| 邮箱收到验证码（旁路异步） | `worker/aliyun_mail.py` |
