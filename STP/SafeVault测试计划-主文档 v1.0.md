# SafeVault 软件测试计划（STP）· 主文档

> 文档类型：Software Test Plan（主纲）
> 适用范围：SafeVault 密码安全助手 —— `safevault`（后端）、`safevault_app`（uni-app 新版前端）、`safevault_ui`（旧版前端）三个子工程
> 结构参考：IEEE 829 / ISO-IEC-IEEE 29119，结合本项目实际裁剪

---

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 文档名称 | SafeVault 软件测试计划 · 主文档 |
| 文档编号 | STP-SAFEVAULT-MAIN |
| 版本号 | v1.0 |
| 状态 | 草案（Draft） |
| 编制人 | 待填（QA） |
| 审核人 | 待填（测试负责人 / 研发负责人） |
| 批准人 | 待填（项目负责人） |
| 编制日期 | 2026-06-13 |
| 保密级别 | 内部 |

### 0.1 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-13 | 待填 | 首次建立，覆盖三工程四层级测试与安全测试总纲 |

### 0.2 分册索引

本测试计划采用「主文档 + 分册」组织，主文档定义跨工程共用的策略、环境、流程、风险、追溯，工程级具体测试项与用例落在各分册：

| 文件 | 范围 |
| --- | --- |
| `STP/SafeVault测试计划-主文档 v1.0.md`（本文件） | 总纲、策略、环境、流程、风险、缺陷管理、安全测试总纲、RTM |
| `STP/SafeVault测试计划-safevault后端 v1.0.md` | Python/FastAPI 后端：单元/集成/E2E、认证与零知识备份、限流、安全 |
| `STP/SafeVault测试计划-safevault_app前端 v1.0.md` | uni-app（App+H5）前端：单元/跨端一致性/原生插件回落/集成/E2E |
| `STP/SafeVault测试计划-safevault_ui前端 v1.0.md` | 旧版 Vue Router + Capacitor 前端：与 app 分册的差异化测试项 |

> 说明：`safevault_ui` 与 `safevault_app` 在 store / utils / composable / service 上同名同构（由 ui 迁移而来），故 ui 分册采用「差异化」写法，仅列出与 app 分册不同之处，避免大段重复。

---

## 1. 引言

### 1.1 目的

本计划用于指导 SafeVault 三个子工程在交付前的测试活动，明确**测什么、怎么测、由谁测、何时测、达到什么质量门禁才算通过**。SafeVault 是一款密码管理类应用，其核心价值是「安全」，因此本计划在常规功能/性能/兼容测试之外，**单列安全测试章节**并把端到端加密正确性、跨端密文互通、零知识等列为最高优先级风险。

### 1.2 范围（In / Out of Scope）

**In Scope（纳入测试）：**

- 后端 `safevault`：认证（开户/登录/续签/改密/重置/登出）、加密备份 blob 的上传/下载/元信息/删除、恢复码包裹 DataKey 的存取、token version 立即失效、IP/邮箱限流、零知识边界。
- 前端 `safevault_app`：开户/解锁/库管理/健康度/生成器/分类搜索/回收站/云账户/云备份/改密/生物识别/自动锁定全流程；纯函数与加密垫片；UTS 原生 PBKDF2 插件与 noble JS 回落；H5 与 App 双端跨端密文一致性。
- 前端 `safevault_ui`：与 app 同构的全流程，差异部分（Vue Router 守卫、Capacitor 原生能力、APK 打包）。

**Out of Scope（不纳入本期测试）：**

- 第三方基础设施本身的可靠性（MySQL / Redis / 对象存储 OSS / RabbitMQ / Brevo 邮件服务），仅测被测系统与其交互的正确性，不测中间件自身。
- PRD 中标注 v1.1+ / v2.0 的未实现需求（如 12 词助记词、旧密码 180 天提醒的真实时间逻辑、安全问题题库的端到端流程，以代码实际实现为准——详见各分册的「实现现状核对」）。
- 自动化埋点数据准确性的端到端验证（无后端埋点链路）。
- 渗透测试 / 第三方安全审计（建议另立专项，本计划仅做安全功能验证与白盒安全检查）。

### 1.3 术语与缩略语

| 术语 | 释义 |
| --- | --- |
| 零知识（Zero-Knowledge） | 服务端永不接触明文密码与明文库数据，只存储客户端加密后的密文 blob 与公开的派生配方 |
| KDF | 密钥派生函数。本项目用 PBKDF2-HMAC-SHA256（客户端 600000 次迭代派生 verifier / DataKey；服务端二次慢哈希 verifier） |
| verifier | 密码验证器：客户端用明文密码 + client salt 本地派生的产物（非明文密码），用于登录比对 |
| DataKey / DEK | 数据加密密钥：随机生成，加密整库快照；被「密码」与「恢复码」各包裹一份独立存放 |
| wrappedDataKey | 被包裹（加密）后的 DataKey 密文 |
| KEK | 密钥加密密钥：由密码 / 恢复码经 KDF 派生，用于包裹 / 解包 DataKey |
| token_version（tv） | 账户级令牌版本号；改密/重置自增使旧 access token 立即失效（方案 B 严格立即失效） |
| access / refresh token | 短时效访问令牌（15min）/ 长时效续签令牌（30d，Redis 白名单背书） |
| SHEET_ROUTES | 前端「自右弹出」类页面集合（详情/新增/编辑/改密/恢复码/回收站） |
| crypto-parity | 跨端密文一致性：App 纯 JS（noble）与 H5 WebCrypto 在同输入下逐位一致 |
| UTS 插件 | uni-app 原生子模块 `safevault-pbkdf2`，Android 原生加速 PBKDF2，iOS 占位 |
| STR | Software Test Report，测试报告 |
| RTM | Requirement Traceability Matrix，需求追溯矩阵 |

### 1.4 参考文档

| 编号 | 文档 | 用途 |
| --- | --- | --- |
| PRD | `PRD/SafeValut产品需求 v1.0.md` | 功能需求来源（SEC/LIB/GEN/CAT/SCH/HLT/BAK/REC/NF-SEC 编号） |
| DRD | `DRD/SafeValut交互与界面设计 v1.0.md` | 交互与界面还原验收依据 |
| SDD-0 | `SDD/SafeVault模块和接口设计 v1.0.md` | 后端模块与接口契约（接口清单速览） |
| SDD-1 | `SDD/SafeVault模块1-云账户与认证-时序图 v1.0.md` | 认证链路时序（§1~§7）测试依据 |
| SDD-2 | `SDD/SafeVault模块2-加密备份blob存储-时序图 v1.0.md` | 备份 blob 时序（§1~§4）测试依据 |
| ARCH | 项目根 `CLAUDE.md` | 前端架构、路由守卫、SHEET_ROUTES、样式 Token、Capacitor service 边界 |
| RULES | `safevault_app/.MIGRATION_RULES.md` | App 端迁移坑位（禁内联 SVG、禁 Vue Transition、query 不解码等） |

---

## 2. 测试策略与方法

### 2.1 测试金字塔

本项目按经典测试金字塔分配投入，底层多、顶层少：

```
                 ╱╲   E2E（关键业务流程串联，手测为主 + H5/后端自动化）
                ╱──╲
               ╱ 集成 ╲   API+Service+DB、composable+store+service、跨端一致性、插件回落
              ╱──────╲
             ╱  单元   ╲  纯函数(kdf/strength/mask/format/crypto)、service/schema/core、store getters/actions
            ╱──────────╲
```

- **后端**：单元 + 集成已有 pytest 真链路底座（内存 SQLite + fakeredis，**不 mock DB/Redis 语义**），优先把这层加厚到覆盖率门禁。
- **前端**：单元层目前缺失（无测试框架），**建议引入 Vitest**，先覆盖纯函数与加密垫片（收益最高、最稳定）；集成层覆盖 composable 编排与 store；E2E 层 H5 用 Playwright，App 端真机/模拟器手测。
- **跨端一致性**：`crypto-parity` 已有脚本，纳入 CI 必跑，作为「跨端互通」的硬底座。

### 2.2 测试左移（Shift-Left）

- 提测即冒烟：每次提测先跑冒烟用例子集（见 §9.3），明确「是否接受提测」。
- 纯函数与加密逻辑随开发同步补单测，不积压到测试阶段。
- crypto-parity 与后端 pytest 进 CI，PR 必跑，把回归缺陷拦在合入前。

### 2.3 风险驱动（Risk-Based）

测试投入向高风险区倾斜，优先级排序：

1. **端到端加密 / 零知识正确性**（数据安全，错误即灾难）
2. **跨端密文互通**（App↔H5 数据不通 = 用户数据丢失）
3. **认证与会话失效**（token version、改密/重置立即失效、越权访问 blob）
4. **原生插件回落**（UTS PBKDF2 自检失败须无缝回落 noble，否则登录慢/卡死）
5. **密钥 / 恢复码安全**（包裹密钥、恢复码熵、找回流程）
6. 核心业务流程（开户/解锁/增删改/健康度/生成器/备份）
7. 体验与兼容（脱敏、自动锁定、剪贴板清除、移动视图）

---

## 3. 被测对象与测试环境

### 3.1 三工程技术栈速览

| 工程 | 技术栈 | 运行形态 | 后端依赖 |
| --- | --- | --- | --- |
| `safevault` | Python 3.13 · FastAPI · SQLAlchemy 2.0(async) · Pydantic v2 · Redis · boto3(S3/OSS) · aio-pika(MQ) · PyJWT | ASGI 服务（uvicorn） | MySQL / Redis / 对象存储 / RabbitMQ / Brevo |
| `safevault_app` | Vue 3 · uni-app(@dcloudio/*) · Pinia · @noble/hashes · @noble/ciphers · Sass | App(JSCore)+H5 双端 | 对接 `safevault` 后端（uni.request） |
| `safevault_ui` | Vue 3 · Vite 5 · Vue Router 4 · Pinia · Element Plus(按需) · Sass · Capacitor 8 | H5 + Android(Capacitor 壳) | 对接 `safevault` 后端（fetch） |

### 3.2 环境矩阵

#### 3.2.1 工具链版本

| 组件 | 版本要求 | 说明 |
| --- | --- | --- |
| Python | ≥ 3.13 | 后端运行/测试（pyproject 要求） |
| pytest / pytest-asyncio | ≥ 8.3 / ≥ 0.25 | 后端测试，`asyncio_mode=auto` |
| aiosqlite / fakeredis | ≥ 0.20 / ≥ 2.26 | 后端测试替身（内存库/内存 Redis） |
| Node.js | ≥ 18 LTS（建议 20） | 前端构建、crypto-parity 脚本、Vitest |
| Vite | 5.x | 两前端构建 |
| HBuilderX / uni-cli | 与 @dcloudio 3.0.0-5000720260410001 匹配 | app 工程构建与真机基座 |
| JDK | 21 | ui 工程 APK 打包（build-apk.sh 探测 Android Studio JBR） |
| Android SDK | 与 Capacitor 8 兼容 | APK 打包 |

#### 3.2.2 设备 / 浏览器 / 平台矩阵

| 维度 | 覆盖目标 | 优先级 |
| --- | --- | --- |
| H5 桌面浏览器 | Chrome（基准）、Safari、Firefox、Edge 最新稳定版 | P0 Chrome / P1 其余 |
| H5 移动视图 | Chrome DevTools 移动视图，画布宽 390–480px | P0 |
| Android 真机/模拟器 | Android 9+（PRD 7.3），含一台低端机验证 PBKDF2 性能与回落 | P0 |
| iOS 真机/模拟器 | iOS 14+（PRD 7.3）；注意 UTS 插件 iOS 为占位，走 noble 回落 | P1 |
| 后端运行环境 | 本地 docker-compose（MySQL/Redis/MinIO/RabbitMQ）或测试环境 | P0 |

#### 3.2.3 环境分层

| 环境 | 用途 | 数据 |
| --- | --- | --- |
| 本地开发环境 | 单测、冒烟 | 内存 SQLite + fakeredis（后端）/ 本地持久化（前端） |
| 集成测试环境 | 集成/接口测试 | 独立 MySQL/Redis/MinIO，测试专用账号 |
| 预发布环境 | E2E、回归、安全验证 | 接近生产配置，脱敏测试数据 |

---

## 4. 角色与职责

| 角色 | 职责 |
| --- | --- |
| 测试负责人 | 制定/维护本计划，评审用例，把控质量门禁与上线建议 |
| 后端测试工程师 | 执行 `safevault` 分册，维护 pytest 套件与覆盖率 |
| 前端测试工程师 | 执行两前端分册，搭建 Vitest，H5 E2E 自动化，App 真机手测 |
| 安全测试工程师/对口 | 执行安全测试章节（零知识/越权/密钥/恢复码/反编译面） |
| 开发工程师 | 同步补单测、修复缺陷、配合复现，提供可测环境 |
| 项目负责人 | 准入/准出/上线决策 |

---

## 5. 进度里程碑与排期

以相对阶段表示（具体日期排期时填入）：

| 阶段 | 主要活动 | 出口 |
| --- | --- | --- |
| M1 计划与准备 | 评审本计划，搭测试环境，准备测试数据/账号 | 计划批准、环境就绪 |
| M2 单元测试 | 后端补齐 service/schema/core 单测；前端搭 Vitest 覆盖纯函数与垫片 | 单元覆盖率达门禁 |
| M3 集成测试 | 后端 API+DB；前端 composable+store+service；crypto-parity 进 CI；插件回落 | 集成用例通过、跨端一致 |
| M4 E2E 与回归 | 关键流程串联（H5 自动化 + App 真机）；全量回归 | E2E 通过、回归无 P0/P1 |
| M5 安全测试 | 零知识/越权/token/密钥/恢复码/反编译面专项 | 安全用例通过 |
| M6 验收与报告 | 出 STR、缺陷收敛、上线建议 | 准出达标 |

---

## 6. 风险与缓解

| 编号 | 风险 | 影响 | 概率 | 缓解措施 |
| --- | --- | --- | --- | --- |
| R-01 | 端到端加密 / 零知识被破坏（服务端误持明文、密文可被服务端解开） | 致命：违背产品根基 | 低 | 后端用例断言请求/落库/日志均不含明文；白盒走查 service 不解析 ciphertext；安全测试专项 |
| R-02 | 跨端密文不互通（App noble 与 H5 WebCrypto 不一致） | 致命：换端数据丢失 | 中 | `crypto-parity` 脚本进 CI 必跑，PBKDF2/AES-GCM/SHA-256 逐位断言 + 交叉解密 |
| R-03 | UTS 原生 PBKDF2 与 noble 不一致或自检失效未回落 | 高：登录卡死/结果错 | 中 | 逐位自检 `ensureNativeVetted`；强制回落用例；低端机真机验证 |
| R-04 | JSCore 无 WebCrypto/fetch 导致 App 端崩溃或加密不可用 | 高 | 中 | cryptoPolyfill/storagePolyfill/navigation 垫片单测；App 真机回归 |
| R-05 | token_version 失效不及时，旧 access 改密后仍可用 | 高：越权 | 低 | 已有 `test_token_version_auth`；集成补改密/重置后旧 token 立即 401 |
| R-06 | 越权访问他人云备份 blob | 高：数据泄露 | 低 | 备份接口按 userId 归属；用例覆盖 A 用户 token 取 B 用户备份须失败 |
| R-07 | 恢复码 / 密钥包裹逻辑缺陷致数据不可恢复或可被绕过 | 高 | 中 | recovery-blob 存取用例 + 重置后恢复链路 E2E；恢复码熵与归一化单测 |
| R-08 | 剪贴板 60s 未清除 / 自动锁定未触发 | 中：敏感泄露 | 中 | 专项功能用例（含计时验证）+ 后台切换/熄屏验证 |
| R-09 | 限流误伤或失效 | 中 | 中 | 限流阈值边界用例（429/423/账户锁定） |
| R-10 | 前端无既有单测，回归靠手测易漏 | 中 | 高 | 引入 Vitest，纯函数优先；建回归套件与冒烟子集 |
| R-11 | App 端迁移坑位回归（内联 SVG 不渲染、Transition 闪退、query 不解码） | 中 | 中 | 按 `.MIGRATION_RULES.md` 建 App 真机回归清单 |
| R-12 | APK 反编译暴露逻辑/硬编码 | 中 | 中 | 反编译面检查：无硬编码密钥/明文主密码；混淆建议 |

---

## 7. 缺陷管理流程

### 7.1 缺陷等级定义

| 等级 | 定义 | 示例 |
| --- | --- | --- |
| P0（致命） | 阻断核心流程 / 数据丢失 / 安全漏洞 / 崩溃 | 改密后旧 token 仍可用；跨端密文不通；服务端能解开密文；App 启动崩溃 |
| P1（严重） | 主要功能不可用或严重错误，无合理绕过 | 云备份上传后下载内容不一致；登录限流失效；自动锁定不触发 |
| P2（一般） | 次要功能缺陷或有绕过方案 | 健康分扣分边界偏差；脱敏开关偶发；分类排序错误 |
| P3（轻微） | 体验/文案/边角 | 文案错别字；过渡动画方向偶发；间距像素偏差 |

### 7.2 复现概率

必现 / 经常（>50%）/ 偶发（<50%）。每个缺陷必须同时标注等级与复现概率。

### 7.3 缺陷生命周期

`新建（New）→ 确认/指派（Assigned）→ 修复中（In Progress）→ 待验证（Resolved）→ 回归验证（Verified）→ 关闭（Closed）`；不予修复走 `Won't Fix / Deferred` 并记录理由。

> 缺陷跟踪系统占位：建议 Jira 项目 `SAFEVAULT`（或 GitHub Issues，标签 `bug/P0~P3`、`module:backend/app/ui`、`area:crypto/auth/backup/ui`）。

### 7.4 缺陷报告模板

```
【P1】标题：简洁描述问题
工程：safevault / safevault_app / safevault_ui
环境：浏览器/系统版本 / 接口地址 / 端（H5/App-Android/App-iOS）
前置条件：...
复现步骤：1. ... 2. ...
预期结果：...
实际结果：...
复现概率：必现 / 经常 / 偶发
证据：截图 / 日志 / 响应体 / 抓包
初步定位（如能）：模块/函数
关联需求：SEC-xx / BAK-xx / SDD-§x
```

---

## 8. 测试数据管理

### 8.1 前端 mock 数据约定

- 前端业务数据集中在各 store 末尾「mock 实现」区，真实接入替换该段即可。
- vault 内置 5 条样本，**刻意含弱密码（GitHub `123456`）与重复密码（微信/YouTube 共用 `Welcome@2024`）**，用于驱动健康度页逻辑——健康度用例必须基于这批已知样本验证扣分与问题列表。
- 持久化键：`safevault.master`（主密码 mock 明文）、`safevault.account`（是否已开户）、`safevault.*` 系列；开发/演示清掉 `safevault.*` 即重走开户。
- 指纹默认关闭，开户不涉及，用户在设置页自行开启。
- 脱敏：敏感数据默认 `●●●●●●`；账号脱敏经 `utils/maskAccount.js`，受 `settings.maskAccount` 控制。

### 8.2 后端测试数据

- 单元/集成用内存 SQLite + fakeredis，每用例独立、互不串扰（function 作用域）；测试账号经 `conftest.create_account` 构造，密码→verifier 由 `_verifier_from_password` 确定性映射。
- 集成/E2E 环境用独立库与专用测试账号；验证码、限流计数等 Redis key 每轮清理。
- 测试邮箱用专用域名收件箱或 Mock Brevo，避免真实发信。

### 8.3 安全测试样本

- 弱口令字典（命中健康检测/强度评估）、超长输入、特殊字符（含 SQL/XSS 注入样本验证防护）、伪造/过期 token、他人 userId 的 token（越权）。

---

## 9. 准入 / 准出 / 暂停恢复准则

### 9.1 准入准则（Entry Criteria）

- 本计划已评审批准；测试环境与测试数据就绪；被测版本可正常构建/启动并通过冒烟。
- 后端 `pytest` 现有套件全绿；前端 `npm run test:crypto`（crypto-parity）通过。

### 9.2 准出准则（Exit Criteria）

- 计划内用例执行率 100%；通过率：P0/P1 用例 100% 通过。
- **遗留缺陷：P0 = 0、P1 = 0**；P2 ≤ 商定阈值且有结论，P3 记录在案。
- 覆盖率门禁达标（见各分册：后端语句覆盖目标 ≥ 80%、加密/认证核心模块 ≥ 90%；前端纯函数与加密垫片 ≥ 90%）。
- crypto-parity 全项一致；越权/零知识/token 失效安全用例全部通过。
- STR 测试报告与缺陷报告、覆盖率报告齐备。

### 9.3 冒烟用例子集（提测准入门槛）

后端：开户→登录→PUT/GET backup 一致→改密后旧 token 401。
前端：开户设主密码+恢复码→解锁→新增/查看（脱敏切换）→生成器出码→健康度有弱/重复项→（联调）云登录+备份。

### 9.4 暂停准则（Suspension）

- 冒烟不通过 / 出现阻断性 P0（崩溃、加密不可用、跨端不通），暂停后续测试，退回开发。
- 测试环境不可用（后端依赖宕机、基座无法安装）超过半个工作日。

### 9.5 恢复准则（Resumption）

- 阻断缺陷修复并通过冒烟验证；环境恢复可用后，从受影响用例集重新执行（必要时全量回归）。

---

## 10. 安全测试总纲（密码管理 App 重点）

> 各工程的具体安全用例落在分册，这里定义安全测试的统一目标与检查项清单。安全测试是本产品的**最高优先级**。

| 编号 | 安全测试项 | 验证目标 | 主责工程 |
| --- | --- | --- | --- |
| SECT-01 | 端到端加密 / 零知识 | 服务端落库与日志只存密文 blob，永不持有/打印明文密码与明文库；服务端无法解开 ciphertext | 后端 + 前端 |
| SECT-02 | KDF 参数强度 | PBKDF2-HMAC-SHA256 客户端迭代 600000、服务端二次慢哈希；salt 随机；参数不弱化 | 后端 + 前端 |
| SECT-03 | 传输安全 | 生产强制 HTTPS；token 经 Authorization Bearer 传输；不在 URL 暴露敏感参数 | 后端 + 前端 |
| SECT-04 | 恢复码安全 | 熵 ≥125bit（Crockford Base32 25+1 校验位）；仅本地校验/归一化；recovery-blob 只存密文 | 前端 + 后端 |
| SECT-05 | 剪贴板 60s 清除 | 复制密码后 60s 自动清空，且仅当剪贴板仍为该密码时才清 | 前端 |
| SECT-06 | 自动锁定 | 后台/熄屏立即锁、前台超时（默认 60s）锁；锁定态密码以密文呈现 | 前端 |
| SECT-07 | 生物识别绕过 | 关闭/失败/不可用回落主密码；无法绕过验证直接读明文；凭据存安全区 | 前端 |
| SECT-08 | 越权访问后端 blob | A 用户 token 不能读/写/删 B 用户备份与 recovery-blob | 后端 |
| SECT-09 | token version 失效 | 改密/重置后旧 access 立即 401；refresh 白名单被清；登出仅吊销单设备 | 后端 |
| SECT-10 | 敏感数据脱敏与日志泄露 | UI 默认脱敏；服务端/客户端日志不打印 verifier/明文/token 全文 | 后端 + 前端 |
| SECT-11 | APK 反编译面 | 反编译无硬编码密钥/明文主密码；建议代码混淆；secureCredential 不明文落地 | ui（Capacitor）/ app |
| SECT-12 | 注入与输入校验 | 邮箱/验证码/checksum/size 边界校验；防 SQL 注入（ORM 参数化）/ XSS（前端转义） | 后端 + 前端 |
| SECT-13 | 限流与暴力破解 | 登录失败计数达阈值账户锁定（423）；IP/邮箱限流（429）；防邮箱枚举（伪 kdf-params） | 后端 |

---

## 11. 交付物清单

| 交付物 | 说明 | 责任方 |
| --- | --- | --- |
| 测试计划（本 STP 主文档 + 3 分册） | 已交付 | QA |
| 测试用例集 | 各分册用例表 + 可执行自动化用例（pytest / Vitest / Playwright） | QA + 开发 |
| 测试报告 STR | 执行结果、通过率、缺陷统计、上线建议（归档至 `STR/`） | QA |
| 缺陷报告 | Jira/Issues 缺陷清单与生命周期记录 | QA |
| 覆盖率报告 | 后端 pytest-cov；前端 Vitest coverage | QA + 开发 |
| crypto-parity 报告 | 跨端一致性脚本输出 | QA + 开发 |

---

## 12. 需求追溯矩阵（RTM）总表

> 把 PRD / SDD 关键需求映射到测试用例 ID（用例 ID 在各分册定义，命名：`后端 BE-*`、`app 前端 FE-*`、`ui 前端 UI-*`、`安全 SECT-*`）。此处给出主映射，分册内细化到具体步骤。

| 需求编号 | 需求摘要 | 来源 | 主责工程 | 关联用例 ID |
| --- | --- | --- | --- | --- |
| SEC-01/04a | 设主密码 + KDF 派生密钥 | PRD §5.1.1 | 前端 | FE-ONB-01/02、UT-KDF-01 |
| SEC-03/REC-01/02 | 生成恢复码并确认保存 | PRD §5.1.5/5.1.6 | 前端 | FE-ONB-03、UT-REC-01/02 |
| SEC-05/06 | 生物识别解锁 + 主密码兜底 | PRD §5.1.2 | 前端 | FE-UNL-01/02 |
| SEC-07 | 连续失败锁定（前端）/ 登录失败锁定（后端 423） | PRD §5.1.2 | 后端+前端 | BE-LOGIN-LOCK-01、FE-UNL-03 |
| SEC-08/09/10 | 自动锁定 + 锁定态脱敏 | PRD §5.1.3 | 前端 | FE-LOCK-01/02、SECT-06 |
| CP-01/02/03 | 一键复制 + 60s 清剪贴板 | PRD §5.2.4 | 前端 | FE-COPY-01、SECT-05 |
| LIB-01~08 | 库列表/增删改/回收站/脱敏 | PRD §5.2 | 前端 | FE-VAULT-* |
| GEN-01~06 | 密码生成器 | PRD §5.3 | 前端 | FE-GEN-*、UT-GEN-01 |
| CAT/SCH | 分类与搜索 | PRD §5.4 | 前端 | FE-CAT-*、FE-SCH-* |
| HLT-01~06 | 健康度（弱/重复/分值/本地） | PRD §5.5 | 前端 | FE-HLT-*、UT-HLT-01 |
| BAK（云备份化） | 云端加密备份上传/下载/元/删 | SDD-2 §1~§4 | 后端+前端 | BE-BAK-*、FE-CLOUD-* |
| 认证开户/登录 | register/login + kdf-params | SDD-1 §2/§3 | 后端+前端 | BE-AUTH-REG/LOGIN-*、FE-CLOUD-AUTH-* |
| 续签 | refresh 轮转 | SDD-1 §4 | 后端 | BE-AUTH-REFRESH-* |
| 改密 | change-password 全量失效 | SDD-1 §5 | 后端+前端 | BE-CHPWD-*、FE-CHPWD-* |
| 重置 | reset-password + recovery-blob | SDD-1 §6 / SDD-2 | 后端+前端 | BE-RESET-*、BE-RECBLOB-*、FE-RECOVER-* |
| 登出 | logout 吊销单设备 + 本地兜底 | SDD-1 §7 | 后端+前端 | BE-LOGOUT-*、FE-LOGOUT-* |
| NF-SEC-01~08 | 加密/KDF/不落地明文/导出加密/恢复码熵 | PRD §7.1 | 全部 | SECT-01~04、SECT-10 |
| 跨端互通 | App noble ↔ H5 WebCrypto 一致 | 工程实现 | app | FE-PARITY-01 |
| 原生插件回落 | UTS PBKDF2 自检+noble 回落 | 工程实现 | app | FE-NATIVE-01/02 |

---

*（主文档完。工程级测试项、用例明细、覆盖率门禁详见三份分册。）*
