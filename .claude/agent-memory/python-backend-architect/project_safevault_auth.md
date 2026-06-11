---
name: project-safevault-auth
description: SafeVault 后端认证模块（模块1）的分层、零知识比对约定、限流与登录锁定策略
metadata:
  type: project
---

SafeVault 后端工程位于 `password_assistant/`（与前端 `password_assistant_ui/` 平级），FastAPI 异步分层：api/services/schemas/models/core/client。用 uv 管理（`uv run python ...`），导入自检需在 `password_assistant/app/` 目录下执行（如 `cd app && uv run python -c "import main"`，包内裸导入无 app. 前缀）。

实现按 SDD 时序图逐节推进，注释标注与图中 autonumber 步骤对应。时序图源：`SDD/SafeVault模块1-云账户与认证-时序图 v1.0.md`。已实现 §1 发码、§2 注册、§3 登录、§4 token 续签。§5 改密 / §6 重置后端尚未接入（前端 verifyPassword/changePassword/resetPassword 仍 mock）。

**零知识密码验证器比对**：客户端传 `verifier`（base64，明文密码本地派生，后端拿不到明文）。注册落库 / 登录比对必须用完全相同的服务端慢哈希，否则永远比不中——共享实现抽在 `services/verifier.py`（`hash_verifier(verifier, server_salt)` = PBKDF2-HMAC-SHA256，迭代走 `settings.verifier_hash_iterations`，32B 摘要 base64；`generate_server_salt()` = 16B 随机 base64）。register / login 都引用它，勿在各 service 内自建副本。比对用 `secrets.compare_digest` 恒定时间。

**限流约定**（`services/rate_limit.py`，滑动窗口 ZSET）：每个接口独立 key 前缀避免互相影响——发码 `ratelimit:email:{email}` + `ratelimit:ip:{ip}`、注册 `ratelimit:register:ip:{ip}`、登录 `ratelimit:login:ip:{ip}`。阈值各有独立 config 项。路由层先调 `enforce_xxx_limit(_client_ip(request))` 再进 service。

**登录失败锁定**（§3）：Redis `fail:{email}` 计数，按邮箱维度。比对前先判定计数 `>= login_fail_threshold(5)` 抛 423；失败即 `INCR`+`EXPIRE login_fail_ttl(900s)` 续期；成功 `DEL` 清零。临时锁定只走 Redis TTL，不落 `account.status`。邮箱不存在 / 验证器不符 / 账户停用(status!=1) 统一对外 401「邮箱或密码不正确」（防邮箱探测），三者都计 fail。邮箱不存在时仍对哑盐 `_DUMMY_SERVER_SALT` 做一次等量慢哈希抹平时序侧信道。

**Redis 调用风格**：`get_redis()` 取全局客户端（`decode_responses=True`，读出是 str）；pipeline 每步都 `await pipe.xxx()` 再 `await pipe.execute()`（见 token.py / rate_limit.py）。

**异常体系**（`core/exception/exceptions.py`）：业务异常继承 `AppError`（带 message + status_code），统一处理器输出 `{ "detail": message }`。已有：CooldownError/RateLimitError(429)、InvalidCodeError(400)、EmailExistsError(409)、AccountLockedError(423)、AuthFailedError(401)、TokenInvalidError(401，§4 refresh 非法/不在白名单「请重新登录」)。

**响应结构**：注册/登录返回 `{ tokens: { accessToken, refreshToken }, userId }`，续签返回 `{ tokens: {...} }`（无 userId）。统一用 `{ tokens: TokenPair }` 包裹（时序图 §4 画的扁平结构仅示意，工程一致性优先），前端统一读 `res.tokens.accessToken`。复用 schema `TokenPair` 与 `services/token.issue_token_pair(user_id)`（签 access 15min/refresh 30d，refresh jti 写白名单 `refresh:{userId}`）。

**§4 token 续签**（`services/token.rotate_refresh_token(refresh_token)`）：路由 `/auth/refresh` 最薄——不经认证服务、不限流、不查库（§4 图一致）。轮转策略：`jwt.decode` 验签+有效期（捕获 ExpiredSignatureError/InvalidTokenError 收敛为 TokenInvalidError）→ 强校验 `type=="refresh"` → SISMEMBER 白名单 → SREM 旧 jti 作废 → 复用 issue_token_pair 签发新对+SADD 新 jti。先验签再查 Redis（无效签名不打 Redis）。旧 refresh 用后即失效（再调 401）。前端 `stores/cloudAccount.js refresh()` 收到 401 → lock() 清登录态导回登录页；`composables/useCloudAccount.refreshSession()` 静默包装（不弹 ElMessage，用户无感）。
