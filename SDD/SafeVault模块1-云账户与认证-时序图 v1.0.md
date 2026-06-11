# SafeVault 模块 1：云账户与认证 — 后端交互时序图

> 配套文档：`SafeVault模块和接口设计 v1.0.md` 第二节「模块 1：云账户与认证」。
> 本文从**客户端发起请求**出发，描绘请求在后端各关键组件间的流转，到结果返回的完整链路。
> 约束：**零知识**——客户端本地用云账户密码派生密钥，发往后端的只是「密码验证器」与密文，后端**永不接触明文密码 / 明文数据**。
> 更新日期：2026-06-09

---

## 一、后端组件总览

模块 1 涉及的后端关键组件及其职责：

```mermaid
flowchart LR
    App["📱 客户端 App<br/>(本地派生密钥/验证器)"]
    GW["🚪 API 网关<br/>限流·鉴权·路由"]
    Auth["🔐 认证服务<br/>auth-service"]
    Token["🎫 Token 服务<br/>JWT 签发/校验"]
    Cache["⚡ Redis<br/>验证码·限流·refresh token"]
    DB["🗄️ 用户库<br/>account 表"]
    Mail["📧 邮件服务<br/>异步发码"]

    App -->|HTTPS| GW
    GW --> Auth
    Auth --> Token
    Auth --> Cache
    Auth --> DB
    Auth --> Mail
    Token --> Cache
```

| 组件 | 职责 | 关键存储 |
| --- | --- | --- |
| API 网关 | TLS 终结、按 IP/邮箱限流、转发、access token 预校验 | — |
| 认证服务 | 注册/登录/改密/重置业务编排，密码验证器比对 | — |
| Token 服务 | 签发 access（短时效）/ refresh（可留存）token、轮转、吊销 | Redis |
| Redis | 验证码（TTL 300s）、发码冷却、登录失败计数、refresh token 白名单 | — |
| 用户库 | 账户记录：`email`、`server_salt`、`password_verifier`、`kdf_params` | 持久化 |
| 邮件服务 | 通过 MQ 异步投递验证码邮件，不阻塞主链路 | — |

> **零知识要点**：`account` 表只存 `password_verifier`（如 SRP verifier 或「密码+服务端盐」的慢哈希），**不存明文、不存可还原密钥**。后端能验证身份，但拿不到 MasterKey。

---

## 1. 下发邮箱验证码 `POST /auth/verify-code`

注册 / 重置共用。重点：网关限流 + Redis 发码冷却 + 邮件异步投递（主链路不等 SMTP）。

```mermaid
sequenceDiagram
    autonumber
    actor App as 📱 客户端
    participant GW as 🚪 API 网关
    participant Auth as 🔐 认证服务
    participant Cache as ⚡ Redis
    participant Mail as 📧 邮件服务

    App->>GW: POST /auth/verify-code { email }
    GW->>GW: 按 IP / email 滑动窗口限流
    alt 超出频率
        GW-->>App: 429 Too Many Requests
    else 通过
        GW->>Auth: 转发请求
        Auth->>Auth: 校验邮箱格式
        Auth->>Cache: GET cooldown:{email}
        alt 60s 冷却内
            Cache-->>Auth: 命中
            Auth-->>App: 429「请稍后再试」
        else 可发送
            Auth->>Auth: 生成 6 位随机验证码
            Auth->>Cache: SETEX code:{email} 300s = 验证码
            Auth->>Cache: SETEX cooldown:{email} 60s
            Auth->>Mail: 投递发码任务（MQ，异步）
            Auth-->>GW: 200 { sent: true }
            GW-->>App: 200（不等邮件实际送达）
            Mail-)App: 📧 邮箱收到验证码（旁路异步）
        end
    end
```

---

## 2. 注册开户 `POST /auth/register`

客户端**本地**已用密码派生出 `password_verifier` 与 KDF 参数，请求体携带的是验证器（非明文）。校验验证码 → 落库 → 签发 token，**注册成功即登录**。

```mermaid
sequenceDiagram
    autonumber
    actor App as 📱 客户端
    participant GW as 🚪 API 网关
    participant Auth as 🔐 认证服务
    participant Cache as ⚡ Redis
    participant DB as 🗄️ 用户库
    participant Token as 🎫 Token 服务

    Note over App: 本地派生 MasterKey，生成 password_verifier + kdf_params（明文密码不出端）
    App->>GW: POST /auth/register { email, verifier, kdf_params, code }
    GW->>GW: 限流通过
    GW->>Auth: 转发

    Auth->>Cache: GET code:{email}
    alt 验证码缺失/不符
        Cache-->>Auth: 不匹配
        Auth-->>App: 400「验证码错误或已过期」
    else 验证码正确
        Auth->>DB: SELECT email 是否已注册
        alt 已存在
            DB-->>Auth: 命中
            Auth-->>App: 409「该邮箱已注册」
        else 可注册
            Auth->>Auth: 生成 server_salt
            Auth->>DB: INSERT { email, server_salt, verifier, kdf_params }
            DB-->>Auth: OK
            Auth->>Cache: DEL code:{email}（用后即焚）
            Auth->>Token: 签发 access(15min) + refresh(30d)
            Token->>Cache: SADD 白名单 refresh:{userId}
            Token-->>Auth: { accessToken, refreshToken }
            Auth-->>GW: 201 { tokens, userId }
            GW-->>App: 201（注册即登录）
        end
    end
```

---

## 3. 登录解锁 `POST /auth/login`

冷启动每次重新登录。后端用密码验证器比对（零知识，**不传明文**），失败计数防爆破。

```mermaid
sequenceDiagram
    autonumber
    actor App as 📱 客户端
    participant GW as 🚪 API 网关
    participant Auth as 🔐 认证服务
    participant Cache as ⚡ Redis
    participant DB as 🗄️ 用户库
    participant Token as 🎫 Token 服务

    App->>GW: POST /auth/login { email, verifierProof }
    GW->>GW: 限流通过
    GW->>Auth: 转发

    Auth->>Cache: GET fail:{email}（失败次数）
    alt 超过阈值（如 5 次）
        Cache-->>Auth: 已锁定
        Auth-->>App: 423「账户暂时锁定，请稍后」
    else 未锁定
        Auth->>DB: SELECT server_salt, verifier BY email
        alt 邮箱不存在 / 验证器不符
            DB-->>Auth: 校验失败
            Auth->>Cache: INCR fail:{email}（TTL 15min）
            Auth-->>App: 401「邮箱或密码不正确」
        else 验证通过
            DB-->>Auth: 命中
            Auth->>Cache: DEL fail:{email}（清零计数）
            Auth->>Token: 签发 access + refresh
            Token->>Cache: SADD 白名单 refresh:{userId}
            Token-->>Auth: { accessToken, refreshToken }
            Auth-->>GW: 200 { tokens }
            GW-->>App: 200 → 进入密码库
        end
    end
```

> 指纹登录为**纯本地快速入口**（系统指纹确认后直接进库），不经过后端，故无对应时序图。

---

## 4. token 静默续签 `POST /auth/refresh`

access token 短时效失效后，用 refresh token 换新。**轮转策略**：旧 refresh 用后即作废，签发新对，降低泄露风险。

```mermaid
sequenceDiagram
    autonumber
    actor App as 📱 客户端
    participant GW as 🚪 API 网关
    participant Token as 🎫 Token 服务
    participant Cache as ⚡ Redis

    App->>GW: POST /auth/refresh { refreshToken }
    GW->>Token: 转发
    Token->>Token: 校验签名与有效期
    Token->>Cache: SISMEMBER 白名单 refresh:{userId}
    alt 不在白名单（已吊销/被盗用）
        Cache-->>Token: 不存在
        Token-->>App: 401「请重新登录」
    else 有效
        Cache-->>Token: 存在
        Token->>Cache: SREM 旧 refresh（轮转作废）
        Token->>Token: 签发新 access + 新 refresh
        Token->>Cache: SADD 新 refresh
        Token-->>GW: 200 { accessToken, refreshToken }
        GW-->>App: 200（静默续签，用户无感）
    end
```

---

## 5. 修改账户密码 `POST /auth/change-password`

设置页发起。**身份已由前端二次确认**。客户端用新密码派生新验证器，并在本地用新 MasterKey 重新包裹 DataKey（DataKey 不变，无需重新加密整库）。后端只更新验证器并吊销其它会话。

```mermaid
sequenceDiagram
    autonumber
    actor App as 📱 客户端
    participant GW as 🚪 API 网关
    participant Auth as 🔐 认证服务
    participant DB as 🗄️ 用户库
    participant Token as 🎫 Token 服务
    participant Cache as ⚡ Redis

    Note over App: 本地以新密码派生新 verifier + 新 salt；重新包裹 DataKey（备份 blob 由模块 2 另行上传）
    App->>GW: POST /auth/change-password<br/>Authorization: Bearer access<br/>{ newVerifier, newSalt }
    GW->>GW: 校验 access token（未过期）
    alt token 无效
        GW-->>App: 401
    else 有效
        GW->>Auth: 转发（带 userId）
        Auth->>DB: UPDATE verifier, server_salt BY userId
        DB-->>Auth: OK
        Auth->>Token: 吊销该用户其它 refresh token
        Token->>Cache: SREM 旧 refresh（仅保留当前会话/可全踢）
        Auth-->>GW: 200 { success }
        GW-->>App: 200「账户密码修改成功」
    end
```

---

## 6. 忘记密码重置 `POST /auth/reset-password`

经邮箱验证码重置后端登录凭据。重置后吊销全部会话。

> ⚠️ **决策点 C（与零知识冲突）**：重置只换后端验证器，**无法解开旧密码包裹的云端 blob**。后端在重置成功后据策略处理云端备份：C1 标记旧 blob 不可解密、提示用户重新上传；C2 走 `recovery-blob` 用恢复凭据解出 DataKey。本图标注该分叉。

```mermaid
sequenceDiagram
    autonumber
    actor App as 📱 客户端
    participant GW as 🚪 API 网关
    participant Auth as 🔐 认证服务
    participant Cache as ⚡ Redis
    participant DB as 🗄️ 用户库
    participant Token as 🎫 Token 服务
    participant Backup as ☁️ 备份服务(模块2)

    Note over App: 已先经 §1 收到邮箱验证码；本地用新密码派生新 verifier + salt
    App->>GW: POST /auth/reset-password { email, code, newVerifier, newSalt }
    GW->>Auth: 转发（限流通过）

    Auth->>Cache: GET code:{email}
    alt 验证码错误/过期
        Cache-->>Auth: 不匹配
        Auth-->>App: 400「验证码错误或已过期」
    else 验证码正确
        Auth->>DB: UPDATE verifier, server_salt BY email
        DB-->>Auth: OK
        Auth->>Cache: DEL code:{email}
        Auth->>Token: 吊销该用户全部 refresh token（强制重新登录）
        Token->>Cache: DEL refresh:{userId}

        rect rgb(255,245,235)
            Note over Auth,Backup: 决策点 C 分叉
            alt C1 接受丢失（纯零知识）
                Auth->>Backup: 标记旧 blob 失效
                Auth-->>App: 200 { resetOk, cloudBackupCleared: true }<br/>提示「云备份需重新上传」
            else C2 恢复凭据(key escrow)
                Note over App: 客户端另用恢复码 GET /backup/recovery-blob 解出 DataKey，再以新密码重新包裹
                Auth-->>App: 200 { resetOk, recoverable: true }
            end
        end
        Note over App: 重置不自动登录 → 回登录页（§3）重新登录
    end
```

---

## 7. 退出登录 `POST /auth/logout`

设置页 / 账户卡片「退出登录」发起。与**自动锁定（lock）**的关键区别：lock 只清会话内存中的密钥、**保留后端会话**（refresh token 仍有效，下次密码 / 指纹可快速重登）；**logout 则连后端会话一并吊销**——把该 refresh token 从 Redis 白名单 `SREM` 移除使其即时失效，下次必须重新走 §3 `/auth/login`。access token 因短时效让其自然过期即可（如需即时失效可选加入黑名单，本图不展开）。

> **零知识不受影响**：logout 全程后端只删 Redis 白名单条目，**不接触任何明文 / 密钥**。
> **失败兜底（本地优先）**：网络失败时客户端**仍本地完成登出**（清会话密钥 + 清本地 refresh token + 回登录页）；后端那条未及移除的白名单项由 refresh token 的 TTL（如 30d）自然过期兜底。logout 主要走 Token 服务 + Redis，不经认证服务与用户库。

```mermaid
sequenceDiagram
    autonumber
    actor App as 📱 客户端
    participant GW as 🚪 API 网关
    participant Token as 🎫 Token 服务
    participant Cache as ⚡ Redis

    App->>GW: POST /auth/logout<br/>Authorization: Bearer access<br/>{ refreshToken }
    GW->>GW: 校验 access token（未过期）
    alt access 无效 / 已过期
        GW-->>App: 401
        Note over App: 本地兜底：仍清会话密钥 + 本地 refresh token → 回 /unlock
    else 有效
        GW->>Token: 转发（带 userId + refreshToken）
        Token->>Token: 校验 refresh 签名，解出 jti
        Token->>Cache: SISMEMBER 白名单 refresh:{userId}
        alt 在白名单（会话有效）
            Cache-->>Token: 存在
            Token->>Cache: SREM refresh:{userId}（吊销该会话，即时失效）
            Note right of Token: access 短时效，自然过期<br/>（如需即时失效可选加黑名单）
            Token-->>GW: 200 { success: true }
            GW-->>App: 200「已退出登录」
        else 不在白名单（已登出 / 已轮转）
            Cache-->>Token: 不存在
            Token-->>GW: 200 { success: true }（幂等：重复登出视为成功）
            GW-->>App: 200
        end
    end
    Note over App: 清会话内存 MasterKey / DataKey + 清本地 refresh token<br/>loggedIn = false → 守卫 requiresUnlock && !loggedIn 拦回 /unlock
```

---

## 附：流程 ↔ 接口 ↔ 后端关键交互对照

| 时序图 | 接口 | 关键后端交互链路 |
| --- | --- | --- |
| §1 发码 | `POST /auth/verify-code` | 网关限流 → Redis 冷却/写码(TTL) → MQ 异步发邮件 |
| §2 注册 | `POST /auth/register` | 校验码 → 查重 → 落库 verifier → 签发 token |
| §3 登录 | `POST /auth/login` | 失败计数 → 验证器比对 → 签发 token |
| §4 续签 | `POST /auth/refresh` | refresh 白名单校验 → 轮转作废 → 签发新对 |
| §5 改密 | `POST /auth/change-password` | access 鉴权 → 更新 verifier → 吊销旧会话 |
| §6 重置 | `POST /auth/reset-password` | 校验码 → 更新 verifier → 全量吊销 → 决策点 C 处理云 blob |
| §7 登出 | `POST /auth/logout` | access 鉴权 → Redis SREM refresh 白名单 → 本地清密钥 |
