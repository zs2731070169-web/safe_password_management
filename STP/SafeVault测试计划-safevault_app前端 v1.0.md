# SafeVault 软件测试计划（STP）· 分册二：safevault_app 前端（uni-app）

> 被测对象：`safevault_app/`（Vue 3 · uni-app @dcloudio · Pinia · @noble/hashes · @noble/ciphers · Sass；App(JSCore)+H5 双端）
> 上位文档：`STP/SafeVault测试计划-主文档 v1.0.md`

---

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | STP-SAFEVAULT-APP |
| 版本号 | v1.0 |
| 编制人 / 日期 | 待填 / 2026-06-13 |

### 修订记录

| 版本 | 日期 | 修订人 | 说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-13 | 待填 | 首次建立 |

---

## 1. 工程特性与测试重点

`safevault_app` 由 `safevault_ui` 迁移为 uni-app 双端工程，最大测试重点来自其运行环境差异：

- **App 逻辑层跑 JSCore**：无 `crypto.subtle` / `fetch`，加密走 `@noble/*` + `utils/cryptoPolyfill.js` 垫片，网络走 `services/http.js`（基于 `uni.request`）。
- **跨端密文必须互通**：App 纯 JS 实现要与 H5 WebCrypto 在同输入下**逐位一致**，否则换端数据丢失（已有 `scripts/crypto-parity-test.mjs`，`npm run test:crypto`）。
- **原生 PBKDF2 加速插件** `uni_modules/safevault-pbkdf2`（Android 原生 / iOS 占位）：通过 `utils/nativePbkdf2.js` 的 `ensureNativeVetted()` 逐位自检，失败必须无缝**回落 noble**。
- **App 端迁移坑位**（见 `.MIGRATION_RULES.md`）：禁内联 SVG（改 data URI）、禁 Vue `<Transition>`（用常驻 + `--open` 类切换）、`onLoad` query 不自动 URL 解码、真机 `<view @click>` 可能不触发（改原生 `<button>`）。

### 1.1 实现现状核对（重要：发现与 PRD 不一致项，须澄清后定基线）

> 测试需基于「代码真实行为」定基线，同时把与 PRD 的偏差作为待澄清缺陷上报，由产品确认是改代码还是改 PRD。

| 项 | PRD 规定 | 代码实际（实地核对） | 处置 |
| --- | --- | --- | --- |
| 恢复码 | 125bit·Crockford Base32·25 字符+1 校验位·`XXXXX-`×5（5 组）·带校验位纠错·`I→1/O→0` 容错 | `services/crypto.js generateRecoveryCode`：**160bit / 32 字符 / 每 4 字符一组（8 组）**；`normalizeRecoveryCode` 仅去非 `0-9A-Z` 并转大写，**无校验位、无 I/O→1/0 纠正** | 记为 **DEF-REC**（待产品澄清）；用例先按代码实际验证，并标注偏差 |
| 健康分 | 基础分 100，逐条按「弱 −15 / 中 −5 / 重复每条 −10 / 旧 −3」扣分 | `stores/health.js computeScore`：各条 `LEVEL_SCORE[level]` 取**均值**，再减「重复扣分（封顶）」，无「旧密码」维度 | 记为 **DEF-HLT**（算法口径不同）；用例按代码实际，标注偏差 |
| 强度分级 | 强/中/弱（基于长度+多样性+弱口令库） | `evaluatePasswordLevel` 返回 0~4，未接入「常见弱口令库」命中判定 | 记为 **DEF-STR**；用例按代码实际 |
| 回收站保留期 | 文案/PRD 多处出现 7 天与 30 天（PRD §5.2.3 写 7 天，SDD §6 回收站纳备份写 30 天窗口） | 以代码 `vault.js` 实际逻辑为准核对 | 记为 **DEF-TRASH**（口径待统一） |

---

## 2. 工具与框架

| 用途 | 工具 | 说明 |
| --- | --- | --- |
| 单元测试（建议引入） | **Vitest** + @vue/test-utils + jsdom | 覆盖纯函数、store、composable；与 Vite 同生态 |
| 跨端一致性 | `scripts/crypto-parity-test.mjs`（已有，Node） | `npm run test:crypto`，进 CI 必跑 |
| 跨端 E2E 加密 | `scripts/crypto-e2e-test.mjs`（已有） | 端到端加解密链路自测 |
| H5 E2E | Playwright（建议） | dev:h5 起服务后跑关键流程 |
| App E2E | uni-automator（已在 devDeps）/ 真机手测 | 真机优先（JSCore 行为只有真机暴露） |
| 类型/构建校验 | `npm run type-check`（uni build --minify false） | 构建期问题前置 |

> 说明：Vitest 在测 App 专属垫片时需注意——纯函数（kdf/strength/mask/format）与 noble 加密可在 Node/jsdom 直接测；涉及 `uni.*` API 的 composable 需 mock uni 全局或在真机验证。

---

## 3. 测试层级与覆盖率门禁

| 层级 | 范围 | 门禁 |
| --- | --- | --- |
| 单元 | utils 纯函数、crypto、stores getters/actions、composable 编排 | 纯函数与加密垫片语句覆盖 ≥ 90%；store 关键 actions ≥ 80% |
| 集成 | composable+store+service 协作、跨端 crypto-parity、UTS 插件回落 | crypto-parity 全项一致；回落路径覆盖 |
| E2E | 关键业务流程（H5 自动化 + App 真机） | 关键流程 100% 通过 |

---

## 4. 单元测试用例清单

> 用例 ID：`FE-UT-*`。被测均为可在 Node/jsdom 直跑的纯逻辑。

### 4.1 KDF 与加密（`utils/kdf.js` / `services/crypto.js`）

| 用例ID | 对象 | 步骤/输入 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-UT-KDF-01 | `kdf.deriveVerifier(password)` | 同密码两次 | 产出 `{verifier,kdfParams{algorithm,salt,iterations,length}}`；iterations=600000；同密码+同 salt 一致 | P0 |
| FE-UT-KDF-02 | `kdf.deriveVerifierWithParams(pwd,params)` | 给定 params 复算 | 与首次同 params 下 verifier 一致（登录复算可比中） | P0 |
| FE-UT-CRY-01 | `crypto.deriveDataKey(pwd,kdfParams)` | 同输入两次 | DataKey 一致；不同密码不同 | P0 |
| FE-UT-CRY-02 | `crypto.encryptJson/decryptJson` | 加密后解密 | 还原原对象；密文含 IV+tag 布局；篡改密文解密失败 | P0 |
| FE-UT-CRY-03 | `crypto.wrapDataKey/unwrapDataKey` | KEK 包裹/解包 DataKey | 解包还原；错 KEK 解包失败 | P0 |
| FE-UT-CRY-04 | `crypto.generateDataKeyRaw/importDataKey` | 生成随机 DataKey | 32B 随机、可导入用于加密 | P1 |
| FE-UT-REC-01 | `crypto.generateRecoveryCode` | 生成多次 | 产出 32 字符（8 组×4）·Crockford 字母表·高熵·不重复（**标注 DEF-REC：与 PRD 5 组/125bit/校验位不符**） | P0 |
| FE-UT-REC-02 | `crypto.normalizeRecoveryCode` | 含连字符/空格/小写输入 | 去非 `0-9A-Z`、转大写（**标注：无 I/O→1/0 纠正、无校验位校验，与 PRD 不符**） | P0 |

### 4.2 密码强度 / 健康度（`utils/passwordStrength.js` / `stores/health.js`）

| 用例ID | 对象 | 输入 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-UT-STR-01 | `evaluatePasswordLevel` | 空串 | 0 | P1 |
| FE-UT-STR-02 | 同上 | `123456`（len6） | 1（弱：len<8） | P0 |
| FE-UT-STR-03 | 同上 | `abcdefgh`（8 位单类） | 1（variety≤1） | P0 |
| FE-UT-STR-04 | 同上 | `Welcome@2024`（12 位三类） | 边界核对：len≥12 且 variety=3 → 3（强） | P0 |
| FE-UT-STR-05 | 同上 | 12 位四类齐全 | 4（很强） | P1 |
| FE-UT-HLT-01 | `health.computeScore` | 空库 | 100 | P1 |
| FE-UT-HLT-02 | 同上 | 内置 5 条样本（含 GitHub 弱、微信/YouTube 重复） | 分值=各条 LEVEL_SCORE 均值−重复扣分（封顶）四舍五入，落 [0,100]（**按代码实际，标注 DEF-HLT**） | P0 |
| FE-UT-HLT-03 | `health.problems/issues` | 同上样本 | 弱项含 GitHub、重复项含微信+YouTube 同组 | P0 |

### 4.3 脱敏 / 格式化 / 生成器（`utils/maskAccount.js` / `formatBackup.js` / `stores/generator.js`）

| 用例ID | 对象 | 输入 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-UT-MASK-01 | `maskAccountText` | 邮箱/手机号/普通串/空 | 按规则脱敏中段，保留可辨识首尾；空安全 | P1 |
| FE-UT-FMT-01 | `formatBackup.formatSize` | 0 / 1023 / 12*1024 / 大值 | 「0 B / 1023 B / 12 KB / …」 | P1 |
| FE-UT-FMT-02 | `formatRelativeTime` | 刚刚/分钟前/小时前/天前/未来 | 正确相对文案；边界稳健 | P1 |
| FE-UT-FMT-03 | `formatBackupSummary` | meta{version,size,updatedAt} | 「上次备份：x · y KB · vN」 | P2 |
| FE-UT-GEN-01 | `generator.mockGenerate` | length=16,全字符类 | 16 位、含各类字符（统计性）；池为空返回 '' | P0 |
| FE-UT-GEN-02 | 同上 | excludeAmbiguous=true | 结果不含 `AMBIGUOUS` 集合字符 | P1 |
| FE-UT-GEN-03 | `generator.secureRandomInt` | 多次 [0,max) | 落区间内、分布无明显偏置；crypto 可用时不走 Math.random | P1 |
| FE-UT-GEN-04 | `generator.setLength` 边界 | <4 / >64 | 钳制到 4~64 区间 | P1 |
| FE-UT-GEN-05 | `generator.hasCharset` | 全部关闭 | false（禁止生成空池） | P1 |

### 4.4 加密垫片与原生插件（App 端核心，`utils/cryptoPolyfill.js` / `nativePbkdf2.js`）

| 用例ID | 对象 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-UT-POLY-01 | `cryptoPolyfill` getRandomValues | App/H5 取随机 | 返回足量随机字节；App 走基座 CSPRNG | P0 |
| FE-UT-POLY-02 | `cryptoPolyfill` PBKDF2/SHA-256/AES-GCM | 对一组固定向量 | 与 WebCrypto 同结果（由 crypto-parity 覆盖） | P0 |
| FE-UT-NAT-01 | `nativePbkdf2.ensureNativeVetted` | 自检逐位比对 | 原生结果与 noble 一致→标记可用；不一致/异常→标记不可用并回落 | P0 |
| FE-UT-NAT-02 | `nativePbkdf2.pbkdf2Sha256` | 原生不可用场景 | 自动走 noble，结果正确 | P0 |

---

## 5. 集成测试用例清单

> 用例 ID：`FE-IT-*`。

### 5.1 跨端一致性与插件回落

| 用例ID | 场景 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-PARITY-01 | crypto-parity 全项 | `npm run test:crypto` | PBKDF2-32B 逐位一致、AES-GCM 密文+tag 逐位一致且交叉解密成功、SHA-256 hex 一致；退出码 0 | P0 |
| FE-PARITY-02 | crypto-e2e | `node scripts/crypto-e2e-test.mjs` | 端到端加解密链路通过 | P0 |
| FE-NATIVE-01 | 原生插件可用（Android 真机） | 触发登录派生 | 走 UTS 原生 PBKDF2 加速；自检通过；登录耗时显著低于纯 JS | P0 |
| FE-NATIVE-02 | 原生不可用/自检失败/iOS | 触发派生 | 无缝回落 noble，功能正确、不卡死 | P0 |

### 5.2 composable + store + service 协作

| 用例ID | 流程 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-IT-CLOUD-01 | 注册开户 | `useCloudAccount`→`cloudAccount.register`→`http.postJson(/auth/register)` | 本地派生 verifier，明文不出端；成功置登录态、存 refresh、kdfParams | P0 |
| FE-IT-CLOUD-02 | 登录 | `cloudAccount.login`（先 kdf-params 后 login） | 用真实 kdfParams 复算 verifier 登录成功；解出/设置会话 DataKey | P0 |
| FE-IT-CLOUD-03 | 改密 | `cloudAccount.changePassword` | 调 /auth/change-password；成功后按 relogin 清本地 token 回登录 | P0 |
| FE-IT-CLOUD-04 | 重置+恢复码 | `cloudAccount.resetPassword`→`recoverWithCode`→`rebuildVault` | 重置后用恢复码 GET recovery-blob 解 DataKey、新密码重新包裹、PUT backup | P0 |
| FE-IT-CLOUD-05 | 续签 | access 过期触发 `cloudAccount.refresh` | 静默换新 token 对，用户无感 | P1 |
| FE-IT-CLOUD-06 | 登出 vs 锁定 | `cloudAccount.logout` / `lock` | logout 调后端吊销+清本地 refresh 回登录；lock 仅清会话密钥保留 refresh；logout 网络失败仍本地登出 | P0 |
| FE-IT-BAK-01 | 自动备份 | vault 增删改触发 `useCloudBackup.pushSnapshot`（debounce） | settings.cloudBackup 为真时 PUT /backup；快照含回收站 | P0 |
| FE-IT-BAK-02 | 换机恢复 | `useCloudRestore`→`pullSnapshot`→`vault.replaceFromSnapshot` | 下载密文本地解密、整库替换；校验 checksum | P0 |
| FE-IT-BAK-03 | 云备份开关 | settings 开/关 | 开→首次全量 PUT；关→仅本地停传（**不调 DELETE**）；删除云端需显式二次确认走 `useDeleteBackup` | P0 |
| FE-IT-BAK-04 | 备份元信息 | `cloudAccount.loadBackupMeta`→GET /backup/meta | 卡片展示「上次备份：x · y · vN」；无备份 hasBackup=false | P1 |
| FE-IT-BIO-01 | 生物识别凭据 | `useBiometricPrompt`+`cloudAccount.saveBiometricCredential/loginByBiometric` | 开启录入、登录复用；`secureCredential` 不明文落地 | P1 |
| FE-IT-AUTOLOCK-01 | 自动锁定 | `useAutoLock`：前台 idle 超 `autoLockSeconds`、`onAppHide`/隐藏后回前台超时 | 触发 `lock()`；锁定态密码脱敏 | P0 |

---

## 6. 端到端测试用例清单（关键业务流程）

> 用例 ID：`FE-E2E-*`。H5 用 Playwright 自动化；App 端真机手测（含迁移坑位回归）。

| 用例ID | 流程 | 关键步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-E2E-ONB-01 | 开户 | 首启→设主密码（≥6 位+二次确认）→展示恢复码→回填确认 | 落 `safevault.master/account`；守卫放行；恢复码确认通过（按 DEF-REC 实际格式） | P0 |
| FE-E2E-UNL-01 | 解锁 | 重启→主密码解锁 / 指纹解锁（已开启） | 解锁进库；错误密码失败提示 | P0 |
| FE-E2E-VAULT-01 | 增删改查 | 新增条目（必填校验）→详情查看（脱敏→明文需验证）→编辑→删除入回收站→回收站恢复/彻底删 | 各步生效；删除二次确认；回收站逻辑符合代码基线（DEF-TRASH 标注） | P0 |
| FE-E2E-VAULT-02 | 脱敏与复制 | 切 `settings.maskAccount`；复制密码 | 账号脱敏切换生效；Toast「已复制，60s 后清除」；60s 后剪贴板清空（仅当仍为该密码） | P0 |
| FE-E2E-GEN-01 | 生成器 | 调长度/字符类/排除易混淆→换一个→用于新增 | 出码符合配置；强度条更新；可回填表单 | P0 |
| FE-E2E-CAT-01 | 分类搜索 | 增/改名/删分类、移动顺序、按分类筛选、关键词搜索（名称/账号/网址/备注） | 筛选与模糊匹配正确；搜索结果密码仍脱敏 | P1 |
| FE-E2E-HLT-01 | 健康度 | 进入健康页（基于内置样本） | 显示健康分、弱项（GitHub）、重复项（微信/YouTube）、「立即修改」入口；全本地无上传 | P0 |
| FE-E2E-CLOUD-01 | 云账户全链路 | 注册→登录→开启云备份→改库触发备份→换机登录→从云端恢复 | 数据完整恢复、跨会话一致 | P0 |
| FE-E2E-RECOVER-01 | 忘记密码恢复 | 忘记密码→验证码重置→新密码登录→恢复码解 DataKey→重传备份→数据可见 | 旧备份经恢复码被新密码解开 | P0 |
| FE-E2E-LOCK-01 | 自动锁定+后台 | 前台静置超时 / 切后台 / 熄屏 | 立即/超时锁定；锁定态全脱敏；重新解锁 | P0 |

### 6.1 App 真机迁移坑位回归（`.MIGRATION_RULES.md`）

| 用例ID | 检查项 | 预期 | 优先级 |
| --- | --- | --- | --- |
| FE-APP-01 | 图标/SVG 渲染 | 全部图标真机正常显示（data URI/CSS mask，无内联 SVG 丢失） | P0 |
| FE-APP-02 | 弹窗动画 | ConfirmSheet 等用常驻+`--open` 类，真机无闪退、动画正常 | P0 |
| FE-APP-03 | 详情/编辑跳转 | 含中文/邮箱@ 的 id 经 `decodeParam` 解码，详情页不白屏弹回 | P0 |
| FE-APP-04 | 可点区域 | 关键可点元素用原生 `<button>`，真机点击均响应 | P1 |
| FE-APP-05 | 软键盘/系统返回 | `useSoftKeyboard`/`navigation` 守卫行为正常 | P1 |
| FE-APP-06 | 登录性能 | 低端 Android 真机登录派生（600000 次 PBKDF2）走原生加速，耗时可接受；iOS 走 noble 回落可用 | P0 |

---

## 7. 安全测试（前端，落主文档 §10）

| 用例ID | 对应 SECT | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| FE-SEC-ZK-01 | SECT-01 | 抓包注册/登录/备份请求 | 仅发 verifier/密文 blob/派生配方，无明文密码、无明文库 | P0 |
| FE-SEC-KDF-01 | SECT-02 | 核对派生参数 | PBKDF2 迭代 600000、随机 salt | P0 |
| FE-SEC-CLIP-01 | SECT-05 | 复制密码后等待 | 60s 后剪贴板清空；期间被覆盖则不误删 | P0 |
| FE-SEC-LOCK-01 | SECT-06 | 后台/熄屏/超时 | 立即/超时锁定，锁定态密码密文呈现 | P0 |
| FE-SEC-BIO-01 | SECT-07 | 关闭/失败/不可用生物识别 | 回落主密码；无法绕过直接读明文；`secureCredential` 安全存储 | P0 |
| FE-SEC-MASK-01 | SECT-10 | 列表/详情/搜索结果 | 默认脱敏 `●●●●●●`；明文有自动隐藏机制 | P0 |
| FE-SEC-LOG-01 | SECT-10 | 控制台/日志 | 不打印明文密码、verifier、token 全文、DataKey | P1 |
| FE-SEC-REC-01 | SECT-04 | 恢复码生成与校验 | 高熵、仅本地校验、recovery-blob 只发密文（**附 DEF-REC 偏差：熵 160bit 但格式与 PRD 不符，待澄清是否满足 NF-SEC-08 的 ≥128bit**） | P0 |

---

## 8. 通过准则与门禁落地

**Entry：** `npm run test:crypto` 通过；H5 可 `dev:h5` 启动并过冒烟；App 可出基座真机安装。

**Exit：**
- 引入 Vitest 后纯函数与加密垫片覆盖 ≥ 90%；crypto-parity 全项一致；插件回落用例通过。
- 关键 E2E 流程 100% 通过；App 真机迁移坑位回归无 P0/P1。
- DEF-REC / DEF-HLT / DEF-STR / DEF-TRASH 偏差项已提交产品并有结论（改代码或改 PRD），不带 P0/P1 悬挂。

```bash
# 跨端一致性（已可用）
npm run test:crypto
# 引入 Vitest 后（建议）
npx vitest run --coverage
# H5 E2E（建议）
npm run dev:h5     # 另起 Playwright 用例
```

---

## 9. 风险（app 侧，细化主文档 §6）

| 风险 | 缓解 |
| --- | --- |
| JSCore 行为只在真机暴露（垫片/导航/存储） | 关键 composable 真机回归，不只 H5/jsdom |
| 原生插件升级/基座变更致自检失败 | 每次基座变更跑 FE-NATIVE-01/02；保留 noble 回落兜底 |
| 恢复码格式与 PRD 不一致（DEF-REC）影响可恢复性承诺 | 优先澄清；恢复码改动须重测 E2E-RECOVER-01 |
| 自动备份 debounce 与离线/弱网竞态 | 弱网/离线下增改库后联网，验证最终一致与版本防回退（409 静默） |
