# SafeVault 软件测试计划（STP）· 分册一：safevault 后端

> 被测对象：`safevault/`（Python 3.13 · FastAPI · SQLAlchemy 2.0 async · Pydantic v2 · Redis · boto3/OSS · aio-pika/MQ · PyJWT）
> 上位文档：`STP/SafeVault测试计划-主文档 v1.0.md`（策略、环境、流程、安全总纲、RTM 以主文档为准）

---

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | STP-SAFEVAULT-BE |
| 版本号 | v1.0 |
| 编制人 / 日期 | 待填 / 2026-06-13 |

### 修订记录

| 版本 | 日期 | 修订人 | 说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-13 | 待填 | 首次建立 |

---

## 1. 测试范围与实现现状核对

### 1.1 In Scope

- **认证模块（模块 1，`app/api/auth.py`）**：`POST /auth/verify-code`、`/register`、`/kdf-params`、`/login`、`/refresh`、`/change-password`、`/reset-password`、`/logout`。
- **加密备份模块（模块 2，`app/api/backup.py`）**：`PUT/GET /backup`、`GET /backup/meta`、`DELETE /backup`、`PUT/GET /backup/recovery-blob`。
- **服务层**：`services/`（register/login/verifier/token/change_password/reset_password/backup/rate_limit/verify_code）。
- **Schema 校验层**：`schemas/auth.py`、`schemas/backup.py`（Pydantic 边界）。
- **核心层**：`core/`（异常映射、base、oss、mq）；鉴权依赖 `api/deps.py`。

### 1.2 现状核对（依据实地代码）

- 已有 pytest 套件覆盖：备份上传/下载/元信息/删除、改密、重置、token version 鉴权（共 8 个测试文件，详见 §4 缺口分析）。
- 测试底座：`conftest.py` 用内存 SQLite（aiosqlite）+ fakeredis，**不 mock DB/Redis 语义**，跑真链路；OSS 与 MQ 在备份测试里用替身（`fake_oss` / `patched_put_object`）。
- 当前 `pyproject.toml` 未声明 `pytest-cov`，覆盖率门禁需新增该依赖。

### 1.3 Out of Scope

- MySQL/Redis/MinIO/RabbitMQ/Brevo 中间件自身可靠性。
- 邮件真实送达（`services/verify_code` 投递 MQ 后即返回，不等送达；E2E 用 Mock/专用收件箱）。

---

## 2. 工具与框架

| 用途 | 工具 | 说明 |
| --- | --- | --- |
| 单元/集成/接口 | pytest + pytest-asyncio | `asyncio_mode=auto`，`pythonpath=["app"]` |
| 真链路替身 | aiosqlite（内存库）+ fakeredis | 验证真实落库与 Redis 读写语义 |
| API 测试客户端 | FastAPI `TestClient`（httpx） | 已随依赖提供（httpx 运行时依赖） |
| OSS 替身 | 自建 `fake_oss` / monkeypatch `put_object` | 隔离 boto3 真实写桶 |
| 覆盖率（待补） | pytest-cov | 生成语句/分支覆盖率报告 |
| E2E（联调） | httpx + pytest 跑真服务 | 连测试环境真 MySQL/Redis/MinIO |

---

## 3. 测试层级与目标

| 层级 | 目标 | 覆盖率门禁 |
| --- | --- | --- |
| 单元 | service / schema / core 纯逻辑正确（verifier 哈希、token 编解码、限流窗口、checksum/size 校验、异常映射） | 加密/认证核心模块（verifier/token/backup/deps）语句覆盖 ≥ 90% |
| 集成 | API + service + DB(+Redis/OSS 替身) 协作：真实落库、token_version 自增比对、白名单增删、blob 顺序写 | 整体语句覆盖 ≥ 80%，分支覆盖 ≥ 70% |
| E2E | 连真中间件跑认证+备份完整业务链路（开户→登录→备份→改密→重置→恢复） | 关键链路 100% 通过 |

---

## 4. 已有用例盘点与缺口分析

### 4.1 已覆盖（保持回归）

| 文件 | 覆盖点 |
| --- | --- |
| `test_backup_upload.py` | 首传成功、高版本覆盖、版本回退拒绝（409）、force 覆盖重建基线、force 保留较高本地版本、非法 checksum（400）、坏 base64 密文、超体积（413）、缺/坏 token（401） |
| `test_backup_download.py` | 上传后下载一致、覆盖后取最新、无备份 404、缺/坏 token 401 |
| `test_backup_meta.py` | 无备份 hasBackup=false（200）、上传后全字段、覆盖后取最新、缺/坏 token 401 |
| `test_backup_delete.py` | 无备份幂等且跳过 OSS、上传后删元信息与 blob、重复删幂等、缺/坏 token 401 |
| `test_change_password.py` | 改密成功全量会话失效、旧 verifier 错拒绝、新旧相同拒绝、账户不存在 |
| `test_reset_password.py` | 重置成功全量失效、错验证码拒绝、未注册邮箱同错（防枚举） |
| `test_token_version_auth.py` | 合法 access 通过、版本自增后旧 access 拒绝、无 tv 旧 access 拒绝、缺凭据、账户不存在、invalidate 效果、tv 缓存→DB、签发 access 带当前版本并白名单 refresh |

### 4.2 识别到的缺口（建议补充）

| 缺口 | 说明 | 优先级 |
| --- | --- | --- |
| `register` 路径用例 | 注册成功 201、验证码错/缺（400）、邮箱已注册（409）、用后删码、签发 token+白名单 refresh | P0 |
| `login` 路径用例 | 登录成功、verifier 不符 401、失败计数累加、达阈值账户锁定 423、成功清零 fail | P0 |
| `kdf-params` 用例 | 已注册返回真实配方、未注册返回确定性伪配方（防枚举，两者结构不可区分） | P1 |
| `refresh` 轮转用例 | 合法轮转作废旧 jti、用 access 冒充被拒、非白名单 refresh 401、过期/篡改 401 | P0 |
| `logout` 用例 | 吊销单 refresh、幂等（重复/已失效/不在白名单仍 200）、不自增 tv（不波及其它设备） | P1 |
| `verify-code` 用例 | 限流（邮箱+IP，429）、冷却命中 429、投递 MQ（替身断言）、邮箱格式 422 | P1 |
| `recovery-blob` 用例 | PUT 覆盖 upsert、GET 命中、无记录 404、缺/坏 token 401、零知识（落库即请求密文） | P0 |
| 限流通用用例 | register/login/reset 各 scope 的 IP 阈值边界（达限 429、窗口过期重置） | P1 |
| 零知识断言 | 备份/恢复落库列与响应不含明文；日志不打印 verifier/明文（白盒+断言） | P0 |

---

## 5. 测试项与典型用例清单

> 用例 ID 命名：`BE-<模块>-<序号>`。前置条件中「已注册账户」指经 `conftest.create_account` 或经 `/auth/register` 建立。

### 5.1 认证：注册开户（SDD-1 §2）

| 用例ID | 前置条件 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| BE-AUTH-REG-01 | 邮箱未注册，验证码正确写入 Redis | POST /auth/register {email,verifier,kdf_params,code} | 201；返回 tokens+userId；账户落库（server_salt 随机、password_verifier 为二次慢哈希、kdf_params 原样）；`code:{email}` 被删；refresh 进白名单 | P0 |
| BE-AUTH-REG-02 | 验证码错误/缺失 | 同上但 code 错 | 400「验证码错误或已过期」，不落库 | P0 |
| BE-AUTH-REG-03 | 邮箱已注册 | 重复注册 | 409「该邮箱已注册」 | P0 |
| BE-AUTH-REG-04 | verifier 长度<16 或>1024 / kdf_params 非对象 | 构造非法体 | 422（Pydantic 校验） | P1 |
| BE-AUTH-REG-05 | IP 达注册限流阈值 | 连续注册超阈值 | 429 | P1 |
| BE-AUTH-REG-06 | 邮箱大小写/含空格 | `User@X.com ` | 归一化为小写去空格，不产生重复账户 | P2 |

### 5.2 认证：登录解锁与失败锁定（SDD-1 §3）

| 用例ID | 前置条件 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| BE-AUTH-LOGIN-01 | 已注册账户，verifier 正确 | POST /auth/login | 200 tokens+userId；`fail:{email}` 清零；refresh 进白名单 | P0 |
| BE-AUTH-LOGIN-02 | verifier 不符 | 错误 verifier | 401「邮箱或密码不正确」；`fail` INCR（TTL 15min） | P0 |
| BE-AUTH-LOGIN-03 | 邮箱不存在 | 未注册邮箱登录 | 401，同一文案（不泄露是否注册） | P0 |
| BE-LOGIN-LOCK-01 | fail 计数达阈值 | 连续失败到阈值后再登录 | 423「账户暂时锁定，请稍后」 | P0 |
| BE-AUTH-LOGIN-04 | 账户 status 停用 | 登录 | 401 | P1 |
| BE-AUTH-KDF-01 | 已注册 | POST /auth/kdf-params {email} | 返回真实 kdf_params | P1 |
| BE-AUTH-KDF-02 | 未注册 | 同上 | 返回确定性伪配方（同邮箱恒定、结构与真配方不可区分） | P1 |

### 5.3 认证：续签 / 改密 / 重置 / 登出（SDD-1 §4~§7）

| 用例ID | 前置条件 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| BE-AUTH-REFRESH-01 | 持合法 refresh（在白名单） | POST /auth/refresh | 200 新 token 对；旧 jti 被 SREM、新 jti SADD | P0 |
| BE-AUTH-REFRESH-02 | 用 access 冒充 refresh | type≠refresh | 401 | P0 |
| BE-AUTH-REFRESH-03 | refresh 不在白名单/已轮转/过期/篡改 | 调用 refresh | 401「请重新登录」 | P0 |
| BE-CHPWD-01 | 已登录，旧 verifier 正确 | POST /auth/change-password | 200 {success,relogin}；tv 自增；全部 refresh 白名单清空；**不返回新 token** | P0 |
| BE-CHPWD-02 | 改密后用旧 access 访问受保护接口 | 持旧 access 调 GET /backup | 401（tv 落后立即失效） | P0 |
| BE-CHPWD-03 | 旧 verifier 错误 | 改密 | 401「旧密码不正确」 | P0 |
| BE-CHPWD-04 | 新 verifier 与旧派生相同 | 改密 | 400「新密码不能与旧密码相同」 | P1 |
| BE-CHPWD-05 | 账户不存在（token 指向已删账户） | 改密 | 401 | P1 |
| BE-RESET-01 | 验证码正确 | POST /auth/reset-password | 200 {resetOk,recoverable:true}；tv 自增；白名单清空；删码；**不签发 token** | P0 |
| BE-RESET-02 | 验证码错 | 重置 | 400 | P0 |
| BE-RESET-03 | 未注册邮箱 | 重置 | 400（同一文案，防枚举） | P1 |
| BE-RESET-04 | 重置后旧 access | 持旧 access 调受保护接口 | 401 | P0 |
| BE-LOGOUT-01 | 已登录 | POST /auth/logout {refreshToken} | 200 {success}；该 refresh SREM；**不自增 tv** | P1 |
| BE-LOGOUT-02 | refresh 已失效/不在白名单/重复登出 | 再次 logout | 200（幂等） | P1 |
| BE-LOGOUT-03 | 改密对其它设备影响 | logout 后用另一设备 access | 仍有效（不波及其它设备） | P2 |

### 5.4 加密备份 blob（SDD-2 §1~§4）

| 用例ID | 前置条件 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| BE-BAK-UP-01 | 已登录，合法密文 | PUT /backup（version=1） | 200 {version,updatedAt}；先写 OSS 再 UPSERT 元信息；size_bytes=解码字节数 | P0 |
| BE-BAK-UP-02 | 云端已有 v3 | PUT version≤3 且无 force | 409（防回退，乱序/重试静默丢弃语义） | P0 |
| BE-BAK-UP-03 | 换机覆盖 | PUT force=true | 绕过版本序，无条件覆盖并重建单调基线 version=max(本地,云端+1) | P1 |
| BE-BAK-UP-04 | checksum 非 64 位 hex | PUT 非法 checksum | 400「校验值非法」 | P0 |
| BE-BAK-UP-05 | ciphertext 非法 base64 | PUT 坏密文 | 400/拒绝 | P1 |
| BE-BAK-UP-06 | 解码字节超 `backup_max_size_bytes` | PUT 超大密文 | 413「备份体积超限」 | P0 |
| BE-BAK-DL-01 | 已上传 | GET /backup | 200 {ciphertext,wrappedDataKey,kdfParams,version,checksum}；ciphertext 与上传一致 | P0 |
| BE-BAK-DL-02 | 覆盖后 | GET /backup | 返回最新版本内容 | P0 |
| BE-BAK-DL-03 | 无备份 | GET /backup | 404「云端暂无备份」 | P0 |
| BE-BAK-META-01 | 无备份 | GET /backup/meta | **200** {hasBackup:false}（非 404） | P0 |
| BE-BAK-META-02 | 已上传 | GET /backup/meta | 200 {hasBackup:true,version,size,updatedAt}；**不含** ciphertext/checksum/kdfParams | P0 |
| BE-BAK-DEL-01 | 无备份 | DELETE /backup | 200 {deleted:true}（幂等，不查 OSS） | P0 |
| BE-BAK-DEL-02 | 已上传 | DELETE /backup | 先删元信息（GET 立即 404、meta 立即 false）再尽力清 OSS；200 | P0 |
| BE-BAK-DEL-03 | 重复删除 | DELETE 两次 | 均 200（幂等） | P1 |
| BE-RECBLOB-01 | 已登录 | PUT /backup/recovery-blob | 200 {success}；UPSERT 覆盖即最新 | P0 |
| BE-RECBLOB-02 | 已存 recovery-blob | GET /backup/recovery-blob | 200 {wrappedDataKey,kdfParams} | P0 |
| BE-RECBLOB-03 | 无记录 | GET /backup/recovery-blob | 404 | P0 |
| BE-BAK-AUTH-01 | 全部备份接口 | 缺/坏/过期 token | 401 | P0 |

### 5.5 单元层（service / schema / core）

| 用例ID | 测试对象 | 步骤/输入 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| BE-UT-VERIFIER-01 | `verifier.hash_verifier` | 同 verifier+同 salt 两次 | 输出确定一致；不同 salt 输出不同；用 PBKDF2-SHA256、32B、base64 | P0 |
| BE-UT-VERIFIER-02 | `verifier.generate_server_salt` | 多次生成 | 16B 随机、base64、不重复 | P1 |
| BE-UT-TOKEN-01 | `token.decode_access_token` | 合法/篡改/过期/类型错/缺 tv | 合法返回(userId,tv)；其余抛 TokenInvalidError | P0 |
| BE-UT-TOKEN-02 | `token.rotate_refresh_token` | 白名单/非白名单/过期 | 轮转或抛 401 | P0 |
| BE-UT-TOKEN-03 | `token.get_account_token_version` | 先无缓存→DB，后命中缓存 | 首次回库、二次走 Redis 缓存 | P1 |
| BE-UT-BAK-01 | `backup._decode_ciphertext` | 合法/非法 base64 | 合法返回字节；非法抛 400 类异常 | P1 |
| BE-UT-RL-01 | `rate_limit._check_window` | 窗口内计数达 limit / 超 limit / 窗口过期 | 超限抛 429；窗口过期计数重置 | P1 |
| BE-UT-SCHEMA-01 | `schemas.auth` 校验器 | 邮箱归一化、verifier strip、长度边界 | 归一/裁剪/越界 422 | P1 |
| BE-UT-SCHEMA-02 | `schemas.backup` 校验器 | version≥1、checksum 长度 64、wrappedDataKey 长度边界 | 边界拒绝 | P1 |
| BE-UT-EXC-01 | `core/exception` 异常映射 | 各业务异常 | 映射到正确 HTTP 状态码与文案 | P1 |

### 5.6 E2E（连真中间件，httpx + pytest）

| 用例ID | 场景 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| BE-E2E-01 | 开户→备份→换机恢复 | verify-code→register→PUT recovery-blob→PUT backup→（新会话）login→GET backup→GET recovery-blob | 全链路 200；下载密文与上传一致 | P0 |
| BE-E2E-02 | 改密后旧会话全失效再新会话恢复 | login→change-password→旧 access 调 backup（401）→新密码 login→GET backup | 旧 401、新会话可取备份 | P0 |
| BE-E2E-03 | 忘记密码重置 + 恢复码恢复 | reset-password→login(新)→GET recovery-blob→PUT backup(新密码包裹)→GET backup | 旧备份经恢复码可被新密码解 | P0 |
| BE-E2E-04 | 越权 | A 登录得 token，用 A token GET /backup 期望只见 A 的；构造 B 备份后 A 不可见 B | 仅见本账户数据 | P0 |

---

## 6. 安全测试（后端，落主文档 §10）

| 用例ID | 对应 SECT | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| BE-SEC-ZK-01 | SECT-01 | 上传备份后检查 DB 列与 OSS 对象、服务日志 | 仅存密文/派生配方，无明文密码、无明文库；日志不含 verifier 全文 | P0 |
| BE-SEC-ZK-02 | SECT-01 | 白盒走查 backup service | 服务端无任何解密/解析 ciphertext 的代码路径 | P0 |
| BE-SEC-KDF-01 | SECT-02 | 检查 verifier 二次哈希迭代数与 salt | 迭代数符合配置、salt 随机 16B；不可弱化 | P0 |
| BE-SEC-OWN-01 | SECT-08 | A token 读/写/删 B 的 backup 与 recovery-blob | 全部按 A 的 userId 归属，取不到 B 的数据 | P0 |
| BE-SEC-TV-01 | SECT-09 | 改密/重置后用旧 access | 立即 401；refresh 白名单已清 | P0 |
| BE-SEC-TV-02 | SECT-09 | logout 仅吊销单设备 | 其它设备 refresh 仍在白名单 | P1 |
| BE-SEC-INJ-01 | SECT-12 | 邮箱/code/checksum 注入样本与超长输入 | Pydantic + ORM 参数化拦截，无注入、无 500 | P1 |
| BE-SEC-RL-01 | SECT-13 | 登录失败到阈值、发码/注册/重置超 IP 阈值 | 423 / 429 正确触发；窗口过期恢复 | P0 |
| BE-SEC-ENUM-01 | SECT-13 | 未注册邮箱走 kdf-params 与 login | 伪配方不可区分、登录同一 401 文案，无法枚举邮箱 | P1 |
| BE-SEC-LOG-01 | SECT-10 | 触发各接口后查日志 | 不打印 access/refresh 全文、verifier、明文 | P1 |

---

## 7. 通过准则（Entry / Exit）

**Entry：** 现有 8 个测试文件全绿；测试环境（或内存替身）就绪；被测分支可启动。

**Exit：**
- §4.2 列出的缺口用例补齐并通过；P0 用例 100% 通过。
- 覆盖率门禁：整体语句 ≥ 80%、分支 ≥ 70%；`verifier/token/backup/deps` 模块语句 ≥ 90%。
- 安全用例（零知识、越权、token 失效、限流）全部通过；遗留 P0/P1 = 0。

### 质量门禁落地命令（建议）

```bash
# 在 safevault/ 下（先补 pytest-cov 到 dev 依赖）
uv run pytest                                  # 现有全绿
uv run pytest --cov=app --cov-report=term-missing --cov-report=html \
  --cov-fail-under=80                          # 覆盖率门禁
```

---

## 8. 风险（后端侧，细化主文档 §6）

| 风险 | 缓解 |
| --- | --- |
| SQLite 与 MySQL 方言差异掩盖问题（如 ON UPDATE、BIGINT 自增） | 关键落库逻辑额外在集成/E2E 用真 MySQL 验证；conftest 已显式赋 id 规避自增差异 |
| 备份「先写 OSS 后 UPSERT」顺序被破坏致元信息与 blob 不一致 | 用例断言顺序与失败回滚；OSS 写失败时不应残留脏元信息 |
| 限流 Redis key 跨用例串扰 | 每用例独立 fakeredis（已具备）；E2E 每轮清 key |
| 邮件/MQ 异步链路在测试中被吞 | verify-code 用替身断言「已投递」，不验真实送达 |
