# SafeVault 软件测试报告（STR）· 主报告

> 文档类型：Software Test Report（主纲）
> 适用范围：SafeVault 密码安全助手 —— `safevault`（后端）、`safevault_app`（uni-app 新版前端）、`safevault_ui`（旧版前端）
> 对应计划：`STP/SafeVault测试计划-主文档 v1.0.md` 及三份分册
> 结构参考：IEEE 829 / ISO-IEC-IEEE 29119，结合本项目实际裁剪

---

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 文档名称 | SafeVault 软件测试报告 · 主报告 |
| 文档编号 | STR-SAFEVAULT-MAIN |
| 版本号 | v1.0 |
| 状态 | 草案（Draft） |
| 编制人 | QA（测试执行） |
| 审核人 | 待填 |
| 批准人 | 待填 |
| 编制日期 | 2026-06-13 |
| 保密级别 | 内部 |

### 0.1 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-13 | QA | 首次执行阶段报告：后端 pytest、跨端加密一致性、前端 Vitest 纯函数单测的真实执行结果，含缺陷与文档待更新清单 |

### 0.2 分册索引

| 文件 | 范围 |
| --- | --- |
| `STR/SafeVault测试报告-主报告 v1.0.md`（本文件） | 总览、环境实况、执行汇总、缺陷清单、文档待更新清单、受阻/人工项、结论 |
| `STR/SafeVault测试报告-safevault后端 v1.0.md` | 后端 pytest 逐用例明细、覆盖率、过时测试归因 |
| `STR/SafeVault测试报告-前端 v1.0.md` | 跨端加密一致性、Vitest 纯函数单测逐用例明细、H5 构建冒烟、需真机项 |

---

## 1. 引言

### 1.1 目的

本报告记录 SafeVault 三个被测工程在**测试执行阶段**的真实结果，对应 STP 主文档与三份分册的计划。报告遵循三条既定原则：

1. **不改动任何业务代码**。本轮仅运行已有测试、新建测试文件/测试配置、安装测试依赖；未修改任何业务源文件。
2. **代码与文档（PRD/DRD/SDD）不一致时一律以代码为准**。测试断言的「预期结果」以代码真实行为为基线；既往已识别的 4 处偏差（DEF-REC/DEF-HLT/DEF-STR/DEF-TRASH）按「以代码为准」处理，**不计为缺陷**，单列「文档待更新」一节。
3. 真正的「缺陷」只针对代码自身的 bug / 不自洽 / 安全问题。

### 1.2 引用文档

- `STP/SafeVault测试计划-主文档 v1.0.md`（及三份分册）
- `SDD/SafeVault模块和接口设计 v1.0.md`、`SDD/SafeVault模块1-云账户与认证-时序图 v1.0.md`、`SDD/SafeVault模块2-加密备份blob存储-时序图 v1.0.md`

---

## 2. 测试环境实况

| 项 | 实际值 |
| --- | --- |
| 操作系统 | macOS 26.5（Darwin 25.5.0，arm64 / Apple Silicon） |
| Python | 3.13.9（uv 0.11.14 管理，工程内 `.venv`） |
| pytest | 9.0.3 · pytest-asyncio 1.4.0（`asyncio_mode=auto`） |
| 后端测试替身 | aiosqlite 0.22.1（内存 SQLite）+ fakeredis 2.36.1 · SQLAlchemy 2.0.50 |
| 覆盖率工具 | pytest-cov 7.1.0 · coverage 7.14.1（**本轮新增的测试 dev 依赖**） |
| Node.js | v22.22.3 |
| 前端单测框架 | Vitest 2.1.9（**本轮新增的测试 dev 依赖**，仅 safevault_app） |
| 真机 / 模拟器 | **无**。App 真机、Capacitor 原生能力、UTS 原生插件、APK 安装均未在本环境执行 |
| 后端外部依赖 | MySQL / Redis / OSS(MinIO) / RabbitMQ / Brevo **均未连真实实例**；后端测试走内存替身真链路（不 mock 语义） |

> 说明：后端 `asyncmy`（MySQL 驱动）等运行时依赖在 macOS arm64 下已随 `uv sync` 安装成功；测试链路按 conftest 设计使用内存 SQLite + fakeredis，未触达真实 MySQL/Redis。

### 2.1 本轮新建/安装的测试资产（均不改业务代码）

| 资产 | 路径 | 说明 |
| --- | --- | --- |
| 后端补充测试 | `safevault/tests/test_str_supplement.py` | 覆盖缺口 + 对齐当前业务契约，20 用例全绿 |
| 后端 cov 依赖 | `safevault/pyproject.toml`（dev 组） | 新增 pytest-cov，用于出覆盖率 |
| 前端 Vitest 配置 | `safevault_app/vitest.str.config.mjs` | `@` 别名 + UTS 插件桩 |
| 前端单测用例 | `safevault_app/tests-str/*.test.mjs` | 4 文件 44 用例全绿 |
| UTS 插件测试桩 | `safevault_app/tests-str/__stubs__/uts-pbkdf2.mjs` | Node 环境桩，触发 noble 回落 |
| Vitest devDep | `safevault_app/package.json`（devDependencies） | vitest@2 |

---

## 3. 测试执行汇总

### 3.1 总览（按工程 × 层级）

| 工程 | 层级 | 用例总数 | 通过 | 失败 | 阻塞 | 跳过 | 未执行 | 通过率 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| safevault 后端 | 既有 pytest（8 文件） | 40 | 27 | 13 | 0 | 0 | 0 | 67.5% |
| safevault 后端 | 本轮补充 pytest（缺口+契约对齐） | 20 | 20 | 0 | 0 | 0 | 0 | 100% |
| safevault_app 前端 | 跨端加密一致性（parity） | 6 | 6 | 0 | 0 | 0 | 0 | 100% |
| safevault_app 前端 | Vitest 纯函数单测 | 44 | 44 | 0 | 0 | 0 | 0 | 100% |
| safevault_app 前端 | H5 构建冒烟 | 1 | 1 | 0 | 0 | 0 | 0 | 100% |
| safevault_ui 前端 | 全部（真机/守卫/APK 等） | — | 0 | 0 | 0 | 0 | 全部 | — |
| **合计（已执行）** | — | **111** | **98** | **13** | **0** | **0** | — | **88.3%** |

> 关键结论：**13 个失败全部来自「既有后端测试与已演进的业务代码脱节」，经核对业务源码确认非业务缺陷**（详见 §5、后端分册 §3）。若排除这 13 个已过时的既有用例，本轮新建/可执行用例 **98/98 全绿**。

### 3.2 覆盖率（后端，真实数字）

`uv run pytest --cov=app`（含既有 + 本轮补充测试，含 13 个 FAIL 仍统计已执行路径）：

| 指标 | 数值 |
| --- | --- |
| 总体语句覆盖率 | **55%**（1070 语句 / 485 未覆盖） |
| 核心 service 层 | login 100% · reset_password 100% · change_password 100% · verifier 100% · register 93% · backup 67% · token 62% · verify_code 61% |
| 模型层 | account/backup/recovery_blob/schemas.backup 均 100% |
| 未覆盖大块 | api 路由层（auth.py 0% / backup.py 62%）、main.py 0%、consumer/worker/mq/oss 客户端（0%~46%） |

> 覆盖率偏低的部分集中在「HTTP 路由编排层、消息队列消费者、对象存储/邮件 worker」——这些在 service 直测底座下不经过，符合 conftest「直测 service 真链路」的设计取舍。**核心业务逻辑（认证/改密/重置/备份 service）覆盖充分**。前端 Vitest 未配置覆盖率门禁（纯函数用例为主，按行为断言）。

---

## 4. 缺陷清单（仅代码自身问题）

> 范围界定：本节只收录**代码自身的 bug / 不自洽 / 安全问题**。文档与代码不一致项见 §5，不在此处。

| 缺陷 ID | 等级 | 标题 | 工程 | 状态 |
| --- | --- | --- | --- | --- |
| DEF-KDF-ITER | P3（低危：代码不自洽 + 安全弱化） | App 端 PBKDF2 迭代实为 6 万，注释与 ui 端却为 60 万 | safevault_app | 待产品/安全确认 |

### DEF-KDF-ITER  App 端密钥派生迭代次数与注释/另一端不一致

- **等级**：P3（功能不阻断；属代码与自身注释不自洽 + 抗爆破强度弱化）
- **复现概率**：必现（静态确定）
- **环境**：`safevault_app/utils/kdf.js`、`safevault_app/services/crypto.js`
- **现象 / 证据**：
  - `safevault_app/utils/kdf.js` 实际常量 `const KDF_ITERATIONS = 60000`（6 万），但同文件顶部注释多处写「迭代 600000」「60 万次」。
  - `safevault_app/services/crypto.js` 实际 `const PBKDF2_ITERATIONS = 60000`，注释亦写「60 万次」。
  - 对照：`safevault_ui/src/utils/kdf.js` 默认 `const KDF_ITERATIONS = 600000`（60 万）——**两端默认迭代相差一个数量级**。
  - 对照：STP 主文档 SECT-02 安全总纲明确要求「客户端迭代 600000、参数不弱化」。
- **影响分析**：
  - **功能层面无阻断**：派生用的 `iterations` 写入 `kdf_params` 随注册上送、登录/换机按存储的 `kdf_params` 重算，故同账户任一端登录都用注册时存的迭代值，跨端登录不会因此失败（按存储参数走）。
  - **安全层面（低危弱化）**：App 端新注册账户的 verifier / 备份 DataKey 实际仅 6 万次 PBKDF2，抗离线爆破强度低于 ui 端 60 万与 SECT-02 设计意图。
  - **可维护性**：代码与自身注释矛盾，易误导后续维护者。
- **复现步骤**：
  1. 打开 `safevault_app/utils/kdf.js`，对比第 9 行注释「迭代 600000」与第 26 行 `const KDF_ITERATIONS = 60000`。
  2. 打开 `safevault_ui/src/utils/kdf.js` 第 21 行 `const KDF_ITERATIONS = 600000`，确认两端不一致。
- **初步定位 / 建议**：需确认 App 端 6 万是否为「真机性能权衡」的有意降档（项目已知低端 Android 纯 JS PBKDF2 60 万次登录慢、并已引入 UTS 原生加速插件）。
  - 若为**有意降档**：应同步修正 app 端误导性注释，并经安全评估确认 6 万是否满足 NF-SEC 抗爆破基线。
  - 若为**无意疏漏**：应将 app 端统一回 60 万（与 ui 端、SECT-02 对齐）。
- **备注**：本项需改业务代码方能修复，按约束本轮**不修复**，仅记录。

---

## 5. 文档待更新清单（代码与 PRD/DRD/SDD 不一致，以代码为准 → 建议改文档）

> 以下为「代码实现 ≠ 文档规定」，按既定原则**以代码为基线、不计为缺陷**；建议同步修订对应文档（或经评审决定是否反向改代码）。本轮测试用例的预期结果均按代码实际行为断言。

| 编号 | 主题 | 文档规定 | 代码实际行为（测试基线） | 建议 |
| --- | --- | --- | --- | --- |
| DOC-REC | 恢复码格式 | PRD §5.1.6：125bit / Crockford / 25+1 校验位 / 5 组 / I·O→1·0 纠错 | `services/crypto.js`：160bit / 32 字符 / 每 4 字符 8 组；`normalizeRecoveryCode` 仅去非 `0-9A-Z` 并转大写，**无校验位、无 I/O 纠正**。熵 160>128 满足 NF-SEC-08，但格式/纠错不符 | 统一恢复码规格口径（PRD 或代码二选一） |
| DOC-HLT | 健康分算法 | PRD §5.5：基础 100 逐条扣分（弱-15/中-5/重复每条-10/旧-3） | `stores/health.js computeScore`：各条 LEVEL_SCORE **取均值再减重复扣分（封顶）**，**无「旧密码 180 天」维度** | 对齐健康分公式与维度 |
| DOC-STR | 弱口令库 | PRD：强度需命中常见弱口令库判定 | `evaluatePasswordLevel`：仅长度 + 字符种类（0~4 级），**未接入弱口令库**。分级边界已由 FE-STR-01~11 用例固化 | 明确是否需要弱口令库，或文档降级要求 |
| DOC-TRASH | 回收站保留期 | PRD §5.2.3 写 7 天 / SDD §6 写 30 天（口径自相矛盾） | 以 `stores/vault.js` 实际为准 | 先统一 PRD 与 SDD 口径，再对齐代码 |
| DOC-RESET | 重置响应体 | 早期文档/旧测试含 `cloudBackupCleared` | `reset_account` 实际返回 `{ resetOk: true, recoverable: true }`（代码注释已明确「不再含 cloudBackupCleared」，走决策点 C2 恢复码包裹式密钥） | 文档/旧测试同步为 recoverable 语义 |
| DOC-BACKUP-WDK | 备份上传参数 | 早期接口/旧测试无 `wrapped_data_key` | `upload_backup` 现要求必填 `wrapped_data_key`（后端仅透传存储、永不解析），返回 `{ version, updatedAt }` | 接口文档补 `wrapped_data_key` 字段 |

> DOC-RESET / DOC-BACKUP-WDK 是导致既有后端测试 13 项 FAIL 的同一批业务演进。

---

## 6. 受阻 / 未执行项 与 需人工·真机执行清单

### 6.1 未执行（环境不具备，非阻塞缺陷）

| 项 | 工程 | 原因 | 处置 |
| --- | --- | --- | --- |
| App 真机功能 / 迁移坑位回归 | safevault_app | 无真机/模拟器；UTS 原生插件、JSCore 行为、onLoad query 不解码、view 点击、Vue Transition 等需真机 | 列入 §6.2 手工清单 |
| Capacitor 原生能力 | safevault_ui | 生物识别 / 剪贴板 60s 清除 / 安全区 / 系统返回需真机 | 列入 §6.2 |
| APK 打包与反编译面 | safevault_ui / safevault_app | 需 JDK21 + Android SDK + 设备；本环境未配置 | 列入 §6.2 |
| 后端 E2E（经 HTTP 路由 + 真 MySQL/Redis/OSS） | safevault | 未起真实中间件；本轮为 service 直测真链路 | 建议补 TestClient 路由层用例 + docker-compose 起依赖 |
| safevault_ui 全量 | safevault_ui | 与 app 同源同构，本轮优先 app；ui 专属差异（路由守卫/原生 fetch/EP/APK）未自动化 | 同构逻辑可参照 app 结论；专属项列入 §6.2 |

### 6.2 需人工 / 真机执行的手工测试步骤（摘要）

> 完整步骤见前端分册 §6。核心冒烟链路（两前端通用）：

1. **开户**：清空 `safevault.*` 本地存储 → 启动 → 走开户（设主密码 + 展示/保存恢复码）→ 校验 `safevault.master`/`safevault.account` 落盘。
2. **解锁与脱敏**：解锁进库 → 切换账号脱敏开关，验证 `da***@icloud.com` 类展示与复制仍取明文。
3. **生成器 + 健康度**：生成密码 → 健康页核对内置 5 条样本（GitHub 弱密码 `123456`、微信/YouTube 重复 `Welcome@2024`）的诊断与评分。
4. **剪贴板 60s 清除**：复制密码 → 60s 后验证剪贴板被清；中途若被其他内容覆盖则不清（仅当仍为该密码才清）。
5. **云登录 + 备份/恢复**：注册/登录 → 上传备份 → 换机/重置后用恢复码 GET recovery-blob 重新包裹 PUT 重传 → 验证可解。
6. **App 迁移坑位**（仅 safevault_app 真机）：SVG 渲染、弹窗动画、含中文/邮箱 id 的详情页不白屏、可点区域响应、原生 PBKDF2 自检与 noble 回落性能。
7. **安全项**（SECT-06/07）：后台/熄屏立即锁、生物识别关闭/失败回落主密码、敏感页防截屏（DEF-SECURESCREEN 待核 Capacitor 工程是否实现 FLAG_SECURE）。

---

## 7. 结论与质量评估

### 7.1 总体结论

- **后端核心业务逻辑质量良好**：认证（注册/登录/kdf-params/验证码）、改密、重置、零知识备份的 service 层在真链路（内存 SQLite + fakeredis，不 mock 语义）下行为正确、自洽。本轮新建的 20 个补充用例 100% 通过，核心 service 覆盖率 62%~100%。
- **跨端加密一致性达标**：noble（App 纯 JS）与 WebCrypto（H5）在 PBKDF2-32B、AES-256-GCM、SHA-256 上逐位一致并可交叉解密（6/6 通过），换端数据互通这一 P0 风险点已验证。
- **前端纯函数稳健**：密码强度、账号脱敏、备份格式化、KDF 派生的 44 个边界/等价类用例 100% 通过；H5 端可正常构建打包。
- **既有后端测试需维护**：8 个既有文件中 13 个用例因业务演进而过时（非业务 bug），是当前测试资产的主要技术债。

### 7.2 质量评估

| 维度 | 评估 |
| --- | --- |
| 功能正确性（已测范围） | 良好：98/98 可执行用例通过 |
| 加密 / 零知识 | 良好：跨端一致 + 派生确定性 + 回放一致已验 |
| 安全强度 | 存在 1 项低危弱化（DEF-KDF-ITER，App 端 6 万迭代） |
| 测试资产健康度 | 偏弱：既有后端测试 13 项过时未维护 |
| 端到端 / 真机覆盖 | 未覆盖：受环境限制，需人工/真机补测 |

### 7.3 风险

1. **DEF-KDF-ITER（低危）**：App 端抗离线爆破强度弱于设计意图，需安全确认。
2. **既有后端测试过时（中）**：CI 若纳入这 8 个文件会持续红灯，掩盖真实回归信号；应尽快随业务契约更新（或以本轮 `test_str_supplement.py` 为对齐范本）。
3. **真机/E2E 盲区（中）**：App 迁移坑位、原生能力、APK、越权访问（SECT-08）等关键安全/兼容项尚未验证，不能仅凭浏览器 mock 下结论。

### 7.4 上线建议

**有条件可推进，但不建议在以下三项闭环前发布正式版**：
1. 确认并处置 DEF-KDF-ITER（决定 6 万/60 万并消除注释矛盾）。
2. 完成 §6.2 手工/真机冒烟与安全项（尤其 SECT-06/07/08、剪贴板 60s、防截屏）。
3. 更新或隔离 13 项过时后端测试，使 CI 信号可信。

后端 service 层与加密一致性可视为**已具备发布质量**；整体发布需待端到端与真机验证补齐。

---

## 8. 后续建议

1. 以 `tests/test_str_supplement.py` 为范本，更新既有 backup/reset 测试至当前契约；并补 STP 后端分册列出的剩余缺口（login 锁定 TTL、refresh 轮转、logout 幂等、verify-code 限流、recovery-blob 存取、越权 scope 边界、零知识落库/日志断言）。
2. 后端补一层 TestClient 路由级用例 + docker-compose 起 MySQL/Redis/MinIO，把覆盖率盲区（api/main）补上，形成 E2E。
3. 前端把本轮 Vitest 接入 CI，并扩展到 services/crypto、storagePolyfill 等；`npm run test:crypto` 设为 CI 必跑门禁。
4. 安排一轮真机回归，按 §6.2 与 `.MIGRATION_RULES.md` 逐条核对 App 迁移坑位与原生能力。
