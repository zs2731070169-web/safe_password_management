# SafeVault 后端（认证服务）

SafeVault「模块 1：云账户与认证」的 Python 后端，已实现 **§1 下发邮箱验证码** `POST /auth/verify-code`
与 **§2 注册开户** `POST /auth/register`（注册即登录）。对齐 `SDD/SafeVault模块1-云账户与认证-时序图 v1.0.md`。

## 技术栈

- **uv** — Python 工程与依赖管理（`pyproject.toml` + `uv.lock`）
- **FastAPI** + Uvicorn — Web 框架
- **MySQL 8**（SQLAlchemy 2.0 异步 ORM + asyncmy）— 主库：云账户/认证、加密备份 blob、恢复凭据
- **Redis** — 验证码（TTL 300s）、发码冷却（60s）、滑动窗口限流、**refresh token 白名单**
- **RabbitMQ**（aio-pika）— 发码任务异步投递，主链路不等邮件送达
- **Brevo 事务邮件 HTTP API** — 实际发信（注册免信用卡，验证发件邮箱即可）
- **PyJWT**（HS256）— 签发 / 校验 access + refresh token

## 数据库（MySQL）

按 `db/schema.sql` 与时序图落地，**全程零知识**：后端只存密文与密码验证器，永不接触明文密码 / 库数据。

> ⚠️ 表命名以 `db/schema.sql` 与时序图为准：模块 1 用**单数 `account` 表**，**不建 `refresh_tokens` 表**——
> refresh token 用 **Redis 白名单 `refresh:{userId}`**（SADD/SISMEMBER/SREM 管理签发、续签校验、轮转作废，
> 见时序图 §2/§4）。下表中 `backup_blob` / `recovery_blob` 为模块 2/3，ORM 模型均已实现、由建表脚本建出。

| 表 | 对应模块 | 状态 | 说明 |
| --- | --- | --- | --- |
| `account` | 模块 1 云账户与认证 | ✅ 已实现 | `email`（唯一）+ `server_salt` + `password_verifier`（服务端叠加 server_salt 慢哈希后的验证器，**非** MasterKey、非明文）+ `kdf_params`(json, 后端仅透传) |
| `backup_blob` | 模块 2 加密备份 blob（核心） | ✅ 已实现 | 每账户**一份**整库密文快照（覆盖式）：`ciphertext`(存 OSS, 永不解析) + `wrapped_data_key`(「密码包裹的 DataKey」base64) + `kdf_params`(密码包裹密钥的 KDF 配方) + `version`(防回退) + `checksum` + `size_bytes` |
| `recovery_blob` | 模块 2/3 决策点 C2（恢复码包裹式密钥） | ✅ 已实现 | 每账户**一份**「恢复码包裹的 DataKey」：`wrapped_data_key`(base64) + `kdf_params`(恢复码包裹密钥的 KDF 配方)。重置（C2）后客户端用恢复码解出 DataKey、以新密码重新包裹重传 |

> refresh token **不落库**，由 Redis 白名单 `refresh:{userId}` 管理（与时序图一致）；登录失败计数 `fail:{email}`、
> 验证码 `code:{email}`、发码冷却 `cooldown:{email}` 同样只在 Redis。

建表（幂等，未引入 Alembic，统一 `create_all`）：

```bash
cd app
uv run python -m core.base.init_db   # 连接 MySQL → 建已注册模型对应的表（account / backup_blob / recovery_blob）→ 退出
```

> 应用启动时 `main.py` 的 lifespan 也会连接 MySQL（不自动建表，首次需手动跑上面的脚本）。
> 三张表（`account` / `backup_blob` / `recovery_blob`）的 ORM 模型均已 import 进 `core/base/init_db.py`，
> 跑上面的脚本即随之建出。
> ⚠️ **`create_all` 不会 ALTER 已存在的表**：本次为 `backup_blob` 新增了 `wrapped_data_key` 列、并新增 `recovery_blob` 表。
> 若库里已有旧 `backup_blob` 表，开发期（数据可丢弃）直接重建即可——先 `DROP TABLE IF EXISTS recovery_blob, backup_blob;`
> 再跑建表脚本；或手动 `ALTER TABLE backup_blob ADD COLUMN wrapped_data_key TEXT NULL;` 后再跑脚本建 `recovery_blob`
> （详见 `core/base/init_db.py` 顶部注释的方案 A/B）。
> 演示重置：`docker compose down -v` 清库卷后，重新 `up -d` 并再跑一次建表脚本。

## 目录结构

```
app/
  main.py              # FastAPI 入口，lifespan 启停 MySQL/Redis/MQ
  config.py            # 环境变量配置（pydantic-settings；含 JWT、慢哈希迭代等）
  api/auth.py          # POST /auth/verify-code、POST /auth/register
  schemas/auth.py      # 请求/响应模型（EmailStr 校验、RegisterRequest/Response）
  core/db/
    base.py            # 声明式 Base + 时间戳 Mixin
    init_db.py         # 建表脚本：python -m core.db.init_db
  models/
    account.py         # Account → account 表（模块1）
  client/
    db_client.py       # MySQL 异步引擎/会话（连接池；init_db / get_session / close_db）
    redis_client.py    # Redis 异步连接
  services/
    rate_limit.py      # 滑动窗口限流（发码 IP/email；注册 IP）
    verify_code.py     # 发码编排：冷却→生码→写码→投递 MQ
    register.py        # 注册编排：校验码→查重→慢哈希落库→删码→签发 token
    token.py           # Token 服务：签发 access/refresh JWT + Redis refresh 白名单
  core/
    exception/
      exceptions.py    # 业务异常（含 InvalidCodeError/EmailExistsError）+ 处理器
    mq/
      producer.py      # RabbitMQ 生产者
      consumer.py      # 通用消费框架（连接/声明/解析/重试/确认）
  comsumer/
    mail.py            # 发码邮件消费者（独立进程，组装通用框架 + 发信 handler）
  worker/
    brevo_mail.py      # Brevo 事务邮件 HTTP API 发信封装
    template.py        # 验证码邮件模板
db/schema.sql          # 完整表结构 DDL（account / backup_blob / recovery_blob）
pyproject.toml         # uv 工程定义与依赖
uv.lock                # 锁定的依赖版本（入库）
docker-compose.yml     # 本地 MySQL + Redis + RabbitMQ
```

## 快速开始

> 本工程用 [uv](https://docs.astral.sh/uv/) 管理依赖与虚拟环境。未安装 uv：`curl -LsSf https://astral.sh/uv/install.sh | sh`

### 1. 安装依赖

```bash
cd safevault
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
# 编辑 .env，填入 Brevo API Key 与已验证的发件邮箱；生产务必覆盖 JWT_SECRET
```

关键变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | MySQL 异步连接串（`mysql+asyncmy://...`） |
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Brevo 事务邮件 v3 API Key 与已验证发件邮箱 |
| `MAIL_PROXY` | 本机联调访问境外 api.brevo.com 的本地代理；直连留空 |
| `JWT_SECRET` | JWT 签名密钥，**生产必须覆盖**（如 `openssl rand -hex 32`） |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | access/refresh 有效期（对齐 15min / 30d） |
| `VERIFIER_HASH_ITERATIONS` | 落库前对客户端 verifier 叠加 server_salt 的 PBKDF2 慢哈希迭代次数 |
| `CODE_TTL` / `COOLDOWN_TTL` | 验证码有效期 / 发码冷却（秒） |
| `RATE_LIMIT_*` / `REGISTER_RATE_LIMIT_IP_PER_WINDOW` | 发码 / 注册限流窗口与阈值 |

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

### §1 发码

```bash
# 正常发码 → 200 {"sent":true}
curl -i -X POST localhost:8000/auth/verify-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'

# Redis 中确认验证码已写入（应有值，TTL≈300）
redis-cli get code:you@example.com
redis-cli ttl  code:you@example.com
```

| 场景 | 结果 |
| --- | --- |
| 正常请求 | `200 {"sent":true}`，worker 日志显示发信，邮箱收到验证码 |
| 60s 内重复同邮箱 | `429 {"detail":"请稍后再试"}`（冷却） |
| 1 分钟内同邮箱第 6 次 | `429 {"detail":"请求过于频繁，请稍后再试"}`（限流） |
| 非法邮箱 `{"email":"bad"}` | `422`（pydantic 校验） |

> 邮件为异步旁路：即便 Brevo 未配置，API 仍立即返回 200，发信失败只在 worker 日志体现。

### §2 注册开户（注册即登录）

零知识：请求体携带客户端本地派生的 `verifier` + `kdf_params`（**非明文密码**），后端永不接触明文。

```bash
# 取出上一步发码写入 Redis 的真验证码（联调时直接读，等同用户收邮件）
CODE=$(redis-cli get code:you@example.com)

# 注册 → 201 { tokens:{accessToken,refreshToken}, userId }
curl -i -X POST localhost:8000/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"you@example.com\",\"verifier\":\"$(openssl rand -base64 32)\",\"kdf_params\":{\"algorithm\":\"PBKDF2-SHA256\",\"salt\":\"$(openssl rand -base64 16)\",\"iterations\":600000,\"length\":32},\"code\":\"$CODE\"}"

# 确认 refresh token jti 已写入白名单、验证码已即焚
redis-cli smembers refresh:1     # 应有一个 jti 成员
redis-cli get code:you@example.com  # 应为空（用后即焚）
```

| 场景 | 结果 |
| --- | --- |
| 验证码正确、邮箱未注册 | `201 { tokens, userId }`，account 落库、refresh 入白名单、code 删除 |
| 验证码缺失/不符 | `400 {"detail":"验证码错误或已过期"}` |
| 邮箱已注册 | `409 {"detail":"该邮箱已注册"}` |
| 同 IP 注册过频 | `429`（注册限流） |
| 邮箱非法 / verifier 过短 / 缺字段 | `422`（pydantic 校验） |

> 落库的 `password_verifier` 是「客户端 verifier 叠加 server_salt 的 PBKDF2 慢哈希」结果，与请求体里的
> verifier 不同；库泄露也无法离线还原 verifier 或明文密码（零知识）。

## 与时序图的对应

| 时序图步骤 | 实现位置 |
| --- | --- |
| 网关按 IP/email 滑动窗口限流 | `services/rate_limit.py`（发码 IP/email；注册 IP） |
| 校验邮箱格式 / 请求体 | `schemas/auth.py`（`EmailStr` / `RegisterRequest`） |
| GET cooldown / 冷却拦截 | `services/verify_code.py` |
| 生成 6 位码 + SETEX code/cooldown | `services/verify_code.py` |
| 投递发码任务（MQ 异步） | `core/mq/producer.py` → `comsumer/mail.py`（基于 `core/mq/consumer.py`） |
| 邮箱收到验证码（旁路异步） | `worker/brevo_mail.py` |
| §2 校验码 → 查重 → 慢哈希落库 → 删码 | `services/register.py` |
| §2 签发 access/refresh + refresh 白名单 | `services/token.py`（Redis `refresh:{userId}`） |
