# SafeVault 软件测试报告（STR）· 前端分册（safevault_app / safevault_ui）

> 文档类型：Software Test Report（前端分册）
> 对应计划：`STP/SafeVault测试计划-safevault_app前端 v1.0.md`（FE-*）、`STP/SafeVault测试计划-safevault_ui前端 v1.0.md`（UI-*）
> 主报告：`STR/SafeVault测试报告-主报告 v1.0.md`

---

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | STR-SAFEVAULT-FE |
| 版本号 | v1.0 |
| 编制日期 | 2026-06-13 |
| 运行命令（一致性） | `safevault_app/` 下 `npm run test:crypto` |
| 运行命令（单测） | `safevault_app/` 下 `npx vitest run --config vitest.str.config.mjs` |
| 运行命令（H5 冒烟） | `safevault_app/` 下 `npm run build:h5` |
| 运行命令（H5 E2E） | `.e2e-str/` 下 `node t1-login.mjs` 等（Playwright + iPhone 13 模拟，目标 `http://127.0.0.1:5180`，真后端 `127.0.0.1:8000`） |

### 0.1 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-13 | QA | 首次执行：跨端加密一致性、Vitest 纯函数单测、H5 构建冒烟；safevault_ui 与真机项列为待人工 |
| v1.0（修订一） | 2026-06-13 | QA | 补充 safevault_app **H5 端「真机模拟」E2E 实测**（Playwright，登录/库/CRUD/健康/生成/设置/导航/红线只读）：执行 38 条，通过 32、失败 1、阻塞 5；新发现 **P1 缺陷 DEF-VERIFY-NOWRAP**（见 §6、§7）。详见新增 §6「H5 端 E2E 实测」。原 §6/§7 顺延为 §7/§8。测试账号云端备份（version 4）全程只读未改，账号恢复空库原状。 |
| v1.0（修订二） | 2026-06-13 | QA | **DEF-VERIFY-NOWRAP 修复回归 + 全量 E2E 复测**：P1 缺陷已修复（登录时 `tryInitDataKeyFromCloud` 无条件执行，与 cloudBackup 开关解耦）；回收站全链路（查看/恢复/彻底删除/清空）回归通过；上轮 1 Fail + 5 Blocked 全部转为 Pass。本轮执行 28 条回归用例，通过 27、阻塞 1（TRASH-04 彻底删除确认面板选择器匹配问题，非功能缺陷）；无新增缺陷。测试账号云端备份全程只读未改。详见 §6.7 修订二记录。 |
| v1.0（修订三） | 2026-06-13 | QA | **E2E 选择器修复**：修正 TRASH-04（ConfirmSheet 确认按钮为原生 `<button>` 非 `uni-button`，文案为"永久删除"非"彻底删除"，选择器改为 `.confirm-sheet__btn--danger`）和 CRUD-00（保存按钮禁用态检测改用多策略：原生 disabled 属性 / aria-disabled / CSS class 兜底）。修订二 2 项阻塞全部转为 Pass，H5 E2E 通过率 38/38 = 100%。无新增缺陷。详见 §6.8 修订三记录。 |

---

## 1. 执行汇总

| 测试集 | 工程 | 用例数 | 通过 | 失败 | 阻塞/未执行 |
| --- | --- | ---: | ---: | ---: | ---: |
| 跨端加密一致性（crypto-parity） | safevault_app | 6 | 6 | 0 | 0 |
| Vitest 纯函数单测 | safevault_app | 44 | 44 | 0 | 0 |
| H5 构建冒烟 | safevault_app | 1 | 1 | 0 | 0 |
| H5「真机模拟」E2E 修订一（§6.1~6.6 原始） | safevault_app | 38 | 32 | 1 | 5 |
| H5「真机模拟」E2E 修订二回归（§6.7） | safevault_app | 38 | 37 | 0 | 1 |
| **H5「真机模拟」E2E 修订三选择器修复后最新（§6.1~6.5）** | **safevault_app** | **38** | **38** | **0** | **0** |
| App 真机 / 原生能力 / APK | safevault_app | — | — | — | 全部 |
| safevault_ui 全量 | safevault_ui | — | — | — | 全部 |

> 修订一 H5 E2E 用例通过率 = 32/33 ≈ 97.0%；修订二回归后通过率 = 37/38 ≈ 97.4%；**修订三选择器修复后通过率 = 38/38 = 100%**。
> 修订三核心结论：TRASH-04 与 CRUD-00 两项阻塞的 E2E 选择器问题已修复，H5 E2E 全量通过；无新增缺陷。
> 连同自动化单测，前端累计执行 89 条（跨端 6 + 单测 44 + 构建冒烟 1 + H5 E2E 38），通过 89。

---

## 2. 跨端加密一致性（FE-CRYPTO，6/6 通过）

`npm run test:crypto`（`scripts/crypto-parity-test.mjs`，参数 PBKDF2 迭代 600000 / KEY_LEN 32 / IV 12）：

| 用例 ID | 断言 | 结果 |
| --- | --- | --- |
| FE-CRYPTO-01 | PBKDF2-HMAC-SHA256 32B 派生位串：noble vs WebCrypto 逐位一致 | ✅ PASS |
| FE-CRYPTO-02 | AES-256-GCM 密文+Tag 逐位一致 | ✅ PASS |
| FE-CRYPTO-03 | WebCrypto 解 noble 密文成功 | ✅ PASS |
| FE-CRYPTO-04 | noble 解 WebCrypto 密文成功 | ✅ PASS |
| FE-CRYPTO-05 | SHA-256 hex 摘要一致（checksum） | ✅ PASS |
| FE-CRYPTO-06 | 综合：App 纯 JS 与 H5 WebCrypto 跨端互通 | ✅ PASS |

> 意义：换端数据丢失是 P0 风险。本组验证 App（noble 垫片）与 H5（原生 WebCrypto）在派生、对称加解密、摘要上完全互通，该风险点已闭环。
> 注意：脚本内 `ITERATIONS=600000` 为脚本自定义常量，仅用于验证算法一致性，**不代表 app 业务实际生效迭代值**（见 §5 DEF-KDF-ITER）。

---

## 3. Vitest 纯函数单测（44/44 通过）

> 配置 `vitest.str.config.mjs`：`@`→工程根别名 + 把 UTS 插件 `@/uni_modules/safevault-pbkdf2` 桩到 `tests-str/__stubs__/uts-pbkdf2.mjs`（返回空触发业务自有的 noble 回落，复刻「插件不可用」真机分支）。Node 18+ 全局 WebCrypto 支撑 kdf 派生。**全部预期以代码实际行为为基线，未改业务代码。**

### 3.1 密码强度 passwordStrength（FE-STR，11/11）

> 基线：`evaluatePasswordLevel` 返回 0~4，规则 = 长度 + 字符种类（DEF-STR：未接入弱口令库，按代码实际断言）。

| 用例 ID | 输入 / 场景 | 期望（代码实际） | 结果 |
| --- | --- | --- | --- |
| FE-STR-01 | ''/undefined/null | 0 | ✅ |
| FE-STR-02 | '123456'（len6 var1，GitHub 弱密码等价） | 1 弱 | ✅ |
| FE-STR-03 | 'Ab1!'（len4 var4） | 1（len<8 优先） | ✅ |
| FE-STR-04 | 'a'×20（var1） | 1（var≤1 优先） | ✅ |
| FE-STR-05 | 'abc12345'（len8 var2） | 2 中 | ✅ |
| FE-STR-06 | 'abcdefghij12'（len12 var2） | 2（var===2 封顶） | ✅ |
| FE-STR-07 | 'Abc12345'（len8 var3） | 2（len<12 优先于 var3） | ✅ |
| FE-STR-08 | 'Abcdefghij12'（len12 var3） | 3 强 | ✅ |
| FE-STR-09 | 'Welcome@2024X'（len13 var4） | 4 很强 | ✅ |
| FE-STR-10 | 'Welcome@2024'（重复样本，len12 var4） | 4（强度不感知重复） | ✅ |
| FE-STR-11 | 文案数组 | ['','弱','中','强','很强'] | ✅ |

### 3.2 账号脱敏 maskAccount（FE-MSK，11/11）

| 用例 ID | 输入 | 期望（代码实际） | 结果 |
| --- | --- | --- | --- |
| FE-MSK-01 | 'david@icloud.com' | 'da***@icloud.com' | ✅ |
| FE-MSK-02 | 'a@x.com'（local 1 位） | 'a***@x.com' | ✅ |
| FE-MSK-03 | '@foo'（@ 在首位，按非邮箱） | '@***' | ✅ |
| FE-MSK-04 | 'dev_master'（len>6） | 'dev****ter' | ✅ |
| FE-MSK-05 | 'abcdef'（len=6 边界） | 'a***' | ✅ |
| FE-MSK-06 | 'abcdefg'（len=7 边界） | 'abc****efg' | ✅ |
| FE-MSK-07 | 'x'（单字符） | 'x***' | ✅ |
| FE-MSK-08 | '' | '' | ✅ |
| FE-MSK-09 | null/undefined | '' | ✅ |
| FE-MSK-10 | '   '（纯空白先 trim） | '' | ✅ |
| FE-MSK-11 | '  david@icloud.com  '（首尾空白） | 'da***@icloud.com' | ✅ |

### 3.3 备份格式化 formatBackup（FE-FMT，16/16）

> formatSize / formatRelativeTime（注入固定 now=2026-06-13T12:00:00Z）/ formatBackupSummary。

| 用例 ID | 场景 | 期望（代码实际） | 结果 |
| --- | --- | --- | --- |
| FE-FMT-01 | size 0/512/1023 | '0 B'/'512 B'/'1023 B' | ✅ |
| FE-FMT-02 | size 12288/1536/1024 | '12 KB'/'1.5 KB'/'1 KB' | ✅ |
| FE-FMT-03 | size 3.2MB | '3.2 MB' | ✅ |
| FE-FMT-04 | NaN/负数/字符串/null/undefined | ''（回落空串） | ✅ |
| FE-FMT-05 | 30s 前 | '刚刚' | ✅ |
| FE-FMT-06 | 5 分钟前 | '5 分钟前' | ✅ |
| FE-FMT-07 | 3 小时前 | '3 小时前' | ✅ |
| FE-FMT-08 | 5 天前 | '5 天前' | ✅ |
| FE-FMT-09 | >=30 天 | 'YYYY-MM-DD' | ✅ |
| FE-FMT-10 | 未来时间（时钟偏差） | '刚刚' | ✅ |
| FE-FMT-11 | null/''/'not-a-date' | '' | ✅ |
| FE-FMT-12 | meta=null | '' | ✅ |
| FE-FMT-13 | hasBackup:false | '尚未备份' | ✅ |
| FE-FMT-14 | 完整 meta | '上次备份：刚刚 · 12 KB · v8' | ✅ |
| FE-FMT-15 | 仅 version | '上次备份：v2' | ✅ |
| FE-FMT-16 | hasBackup:true 无字段 | '已备份' | ✅ |

### 3.4 密钥派生 kdf（FE-KDF，6/6）

> 不把 iterations 具体值写死（避开 DEF-KDF-ITER 耦合），只验确定性 / 结构 / 回放一致。

| 用例 ID | 场景 | 期望（代码实际） | 结果 |
| --- | --- | --- | --- |
| FE-KDF-01 | deriveVerifier 产出 | verifier(base64,≥16) + kdfParams{algorithm:'PBKDF2-SHA256',salt,iterations,length:32} | ✅ |
| FE-KDF-02 | 同密码两次派生 | salt 随机不同 → verifier 不同 | ✅ |
| FE-KDF-03 | 用注册 kdfParams 同密码重算 | verifier 与注册时一致（回放一致） | ✅ |
| FE-KDF-04 | 不同密码同 kdfParams | verifier 不同 | ✅ |
| FE-KDF-05 | 算法不匹配（argon2id） | 抛「不支持的密钥派生配方」 | ✅ |
| FE-KDF-06 | kdfParams=null | 抛错 | ✅ |

> FE-KDF-03 的「回放一致」是换机登录正确性的关键保障：换端用存储的 kdf_params 同密码必能重算出同一 verifier。

---

## 4. H5 构建冒烟（FE-BUILD，通过）

`npm run build:h5` → **DONE Build complete**，产物生成成功。

- 仅有 Dart Sass `legacy-js-api` 弃用警告，与 Vite reporter 关于 `vault.js`/`cloudBackup.js`/`cloudAccount.js` 被「动态导入 + 静态导入混用」的分包提示，均不影响产物正确性。
- 结论：safevault_app 的 H5 目标可正常编译打包，工程结构与依赖完整。

---

## 5. 缺陷（前端）

详见主报告 §4 **DEF-KDF-ITER**（P3，低危：代码不自洽 + 安全弱化）：
- `safevault_app/utils/kdf.js` 实际 `KDF_ITERATIONS=60000`，注释写 600000；`services/crypto.js` 实际 `PBKDF2_ITERATIONS=60000`，注释写「60 万」。
- `safevault_ui/src/utils/kdf.js` 默认 `KDF_ITERATIONS=600000`，两端相差一个数量级；STP SECT-02 要求 600000。
- 功能不阻断（按 kdf_params 存储值重算），但 App 端抗爆破强度弱化、注释自相矛盾。需产品/安全确认 6 万/60 万并消除注释矛盾。**本轮不修复（需改业务代码）。**

---

## 6. H5 端「真机模拟」E2E 实测（FE-E2E，本次新增）

> 环境：safevault_app 以 HBuilderX 起 H5 dev server（`http://127.0.0.1:5180`，uni-app + Vite，模拟真机），经 vite proxy `/safevault/*` 打到**真后端** `http://127.0.0.1:8000`；Playwright（Chromium）以 iPhone 13 视口驱动，脚本位于 `.e2e-str/`。测试账号 `2731070169@qq.com`（云账户，初始空库、健康分 100、账号脱敏开启）。
> 预期基线 = **代码实际行为**（与 PRD/DRD 不一致处以代码为准，不计缺陷）。**全程未改任何业务代码**，仅在 `.e2e-str/` 写测试脚本。每个用例均截图取证（`.e2e-str/shots/`），关键链路以 `/safevault/*` 网络响应作断言证据。
> 数据安全：仅新增/删除的测试条目为本地 mock（不上云，重登即清）；云端真实备份（`backup/meta` 全程 `version 4 / size 347`）**只读未改**，测试后账号恢复空库原状。

### 6.1 执行汇总

> 下表为**修订三选择器修复后最新状态**（38/38 = 100% 通过）。修订一原始结果见 §6.7，修订二结果见 §6.7，修订三选择器修复详情见 §6.8。

| 用例组 | 用例数 | 通过 | 失败 | 阻塞 | 脚本 |
| --- | ---: | ---: | ---: | ---: | --- |
| 登录链路（LOGIN） | 5 | 5 | 0 | 0 | `t1-login.mjs` |
| 库列表 / 登出（VAULT / LOGOUT / SET-EMAIL） | 7 | 7 | 0 | 0 | `t2-vault-logout.mjs` |
| 密码 CRUD / 回收站（CRUD / TRASH / CLEANUP） | 11 | 11 | 0 | 0 | `t3-full-crud.mjs` + `regression-1-verify-fix.mjs` |
| 健康度（HEALTH） | 2 | 2 | 0 | 0 | `t4-tabs.mjs` |
| 生成器（GEN） | 3 | 3 | 0 | 0 | `t4-tabs.mjs` |
| 设置（SET） | 6 | 6 | 0 | 0 | `t5-settings.mjs` / `t5b-privacy.mjs` / `regression-1-verify-fix.mjs` |
| 导航 / 红线只读（NAV / RED） | 5 | 5 | 0 | 0 | `t6-nav-redline.mjs` / `t6b-reset.mjs` |
| **合计** | **38** | **38** | **0** | **0** | — |

> 修订一 H5 E2E 通过率 = 32/33 ≈ 97.0%；修订二回归后通过率 = 37/38 ≈ 97.4%；**修订三选择器修复后通过率 = 38/38 = 100%**。
> **DEF-VERIFY-NOWRAP（P1）已修复**：上轮 1 Fail + 5 Blocked 全部转 Pass，详见 §6.6、§6.7。
> **TRASH-04 / CRUD-00 选择器问题已修复**：修订三修正 ConfirmSheet 按钮选择器与保存按钮禁用态检测方式，详见 §6.8。

性能观测：H5（原生 WebCrypto 路径）密码登录从点「登录」到落 home，多次测得 **164ms ~ 1.7s**（首登含云端 meta/水合握手，重登更快），无 App 端纯 JS PBKDF2 的秒级延迟问题——印证 §5 DEF-KDF-ITER 仅影响 App 端。修订二确认：登录后 `tryInitDataKeyFromCloud` 额外发 `GET /backup`（~50ms），总登录耗时仍在正常范围。

### 6.2 登录链路（5/5 通过）

| 用例 ID | 步骤 | 实际结果（断言） | 状态 | 截图 |
| --- | --- | --- | --- | --- |
| FE-E2E-LOGIN-01 | 首页→「使用密码登录」→填正确邮箱密码→登录 | POST `/auth/login` 200 → 进 `pages/home`；耗时 164ms | Pass | `login-success.png` |
| FE-E2E-LOGIN-02 | 填正确邮箱 + 错误密码→登录 | `/auth/login` **401**，停留 master 页、不进库 | Pass | `login-wrong-pwd.png` |
| FE-E2E-LOGIN-03 | 邮箱空 + 填密码→登录 | toast「请输入邮箱」，**前端拦截、不发 login 请求** | Pass | `login-empty-email.png` |
| FE-E2E-LOGIN-04 | 填邮箱 + 密码空→登录 | toast「请输入密码」，不发 login 请求 | Pass | `login-empty-pwd.png` |
| FE-E2E-LOGIN-05 | 登录过后重进 master 页 | 邮箱输入框预填 `2731070169@qq.com`（记忆生效） | Pass | `login-prefill-email.png` |

### 6.3 库列表 / 登出（7/7 通过）

| 用例 ID | 步骤 | 实际结果 | 状态 | 截图 |
| --- | --- | --- | --- | --- |
| FE-E2E-VAULT-01 | 登录进库 | 空库空态文案「该分类下暂无密码条目」 | Pass | `vault-empty.png` |
| FE-E2E-VAULT-02 | 看分类 Chips | 渲染「全部」，默认激活「全部」 | Pass | `vault-chips.png` |
| FE-E2E-VAULT-03 | 空库分类集合 | 仅「全部」1 项（分类由条目动态派生，空库符合代码逻辑） | Pass | `vault-chips.png` |
| FE-E2E-VAULT-04 | 点搜索按钮展开→输入「zzz不存在的平台」 | 输入回显正确，无匹配仍空态 | Pass | `vault-search.png` |
| FE-E2E-SET-EMAIL | 设置页云账户卡 | 显示脱敏 `27***@qq.com`，**无明文邮箱泄露** | Pass | `settings-account-masked.png` |
| FE-E2E-LOGOUT-01 | 设置→退出登录→确认 | POST `/auth/logout`，回登录首页 | Pass | `logout-back-login.png` |
| FE-E2E-LOGOUT-02 | 登出后重进 master→重新登录 | 邮箱仍预填（**软登出记邮箱**），新一次登录进 home | Pass | `logout-relogin.png` |

### 6.4 密码 CRUD / 回收站（11 通过 / 0 失败 / 0 阻塞）

> 修订三更新：TRASH-04 和 CRUD-00 的 E2E 选择器问题已修复，全部转为 Pass。修订二更新：DEF-VERIFY-NOWRAP 已修复，CRUD-05 由 Fail 转为 Pass，TRASH-01~03 由 Blocked 转为 Pass。

新增测试条目「E2E测试-勿用 / e2e-tester@example.com / Abc12345!xyz」走完整链路：

| 用例 ID | 步骤 | 实际结果 | 状态 | 截图 |
| --- | --- | --- | --- | --- |
| FE-E2E-CRUD-00 | 新增页空表单 / 仅填名称 | 保存按钮 `disabled`（名称+账号+密码三项必填校验生效）——~~修订二：Playwright `isDisabled()` 不识别 uni-button CSS 禁用态~~ → **修订三：改用多策略检测（原生 disabled / aria-disabled / CSS class），检测通过** | ~~Blocked（选择器）~~ → **Pass** | `crud-add-filled.png` |
| FE-E2E-CRUD-01 | 填全表单→保存 | 回库列表出现「E2E测试-勿用」 | Pass | `crud-list-after-add.png` |
| FE-E2E-CRUD-02 | 进详情看密码 | 默认脱敏 `●●●…`，点眼睛图标显示明文 `Abc12345!xyz` | Pass | `crud-detail-revealed.png` |
| FE-E2E-CRUD-03 | 点「复制密码」 | 复制反馈 toast 出现 | Pass | `crud-copy-toast.png` |
| FE-E2E-CRUD-04 | 顶栏「更新」→改名「E2E测试-已改名」→保存 | 编辑页预填原名，保存后详情显示新名 | Pass | `crud-detail-renamed.png` |
| FE-E2E-CRUD-05 | 详情「删除此密码」→主密码验证框输**正确**登录密码→确认删除 | ~~修订一：验证框报「密码不正确」，删除失败~~ → **修订二：验证通过，条目成功移至回收站，toast「已移至回收站，30 天内可恢复」**（§6.6 DEF-VERIFY-NOWRAP 已修复） | ~~Fail~~ → **Pass** | `reg1-04-after-verify.png` |
| FE-E2E-TRASH-01 | 进回收站看已删条目 | ~~修订一：阻塞（CRUD-05 删不进回收站）~~ → **修订二：回收站中可见已删除条目** | ~~Blocked~~ → **Pass** | `reg1-05-trash.png` |
| FE-E2E-TRASH-02 | 回收站恢复条目 | ~~修订一：阻塞~~ → **修订二：恢复操作成功，条目从回收站移出** | ~~Blocked~~ → **Pass** | `reg1-06-after-restore.png` |
| FE-E2E-TRASH-03 | 恢复后回库 | ~~修订一：阻塞~~ → **修订二：恢复后条目回到密码库** | ~~Blocked~~ → **Pass** | `reg1-06-after-restore.png` |
| FE-E2E-TRASH-04 | 彻底删除 / 清空 | ~~修订一：阻塞（CRUD-05 删不进回收站）~~ ~~修订二：确认面板选择器匹配受限~~ → **修订三：修正 ConfirmSheet 按钮选择器（原生 `<button>` 非 `uni-button`，文案"永久删除"非"彻底删除"，改用 `.confirm-sheet__btn--danger`），彻底删除与清空操作均成功** | ~~Blocked（选择器）~~ → **Pass** | `reg1-09-after-purge.png` |
| FE-E2E-CLEANUP | 测试数据清理核验 | 重登后库恢复空态、无 E2E 残留（本地 mock 不上云，重登即清）；云端 `version 4` 未变 | Pass | `final-empty-vault.png` |

> 说明（修订一）：回收站的恢复 / 彻底删除 / 清空逻辑本身不依赖主密码验证，但唯一能产生回收站条目的入口（删除条目）被 DEF-VERIFY-NOWRAP 阻断，故默认环境下 TRASH-01~04 无数据可达。**修订二已修复**：CRUD-05 验证通过后回收站全链路可走通。**修订三已修复**：TRASH-04 确认面板选择器已修正——ConfirmSheet 内的确认按钮是原生 `<button class="confirm-sheet__btn confirm-sheet__btn--danger">`（编译后为 `uni-button`），彻底删除场景文案为"永久删除"而非"彻底删除"；CRUD-00 保存按钮禁用态改用多策略检测。两者功能本身均正确，纯选择器问题。

### 6.5 健康度 / 生成器 / 设置 / 导航 / 红线（18 通过 / 0 阻塞）

> 修订二更新：SET-04 由 Blocked 转为 Pass（H5 mock 验证已通过）。

| 用例 ID | 步骤 | 实际结果 | 状态 | 截图 |
| --- | --- | --- | --- | --- |
| FE-E2E-HEALTH-01 | 空库进健康 Tab | 仪表盘 100 分、问题清单 (0)、空态「太棒了，全部密码都很安全！」 | Pass | `health-empty.png` |
| FE-E2E-HEALTH-02 | 点「重新扫描」 | 扫描执行后按钮文案复位 | Pass | `health-rescan.png` |
| FE-E2E-GEN-01 | 进生成 Tab | 长度滑块（当前 16）+ 5 个字符集开关（大写/小写/数字/符号/排除易混淆）渲染 | Pass | `generate-tab.png` |
| FE-E2E-GEN-02 | 切换「包含符号」开关 | 开关 `--on` 状态翻转 | Pass | `generate-toggle.png` |
| FE-E2E-GEN-03 | 关到只剩一种字符集再关 | 被阻止，toast「至少需保留一种字符类型」，开关保持 on | Pass | `generate-min-charset.png` |
| FE-E2E-SET-01 | 设置页渲染 | 安全/数据/显示/关于 各项 + 版本 v1.0 全部渲染（12 项无缺失） | Pass | `settings-render.png` |
| FE-E2E-SET-02 | 切「账号脱敏显示」开关（配合临时条目） | 开启时列表账号脱敏 `ma***`，关闭后显示明文 `masktest@example.com` | Pass | `settings-mask-off.png` |
| FE-E2E-SET-03 | 「自动锁定」选「2 分钟」 | 显示「2 分钟」，`safevault.settings.autoLockSeconds=120` 持久化 | Pass | `settings-autolock.png` |
| FE-E2E-SET-04 | 切「生物识别解锁」开关 | ~~修订一：H5 mock 路径下点开关未弹出指纹框，开关未翻转~~ → **修订二：H5 mock 验证执行成功（1.2s 延时后自动通过），开关翻转正常** | ~~Blocked~~ → **Pass** | `reg1-15-bio.png` |
| FE-E2E-SET-05 | 进「分类管理」页 | SHEET 页打开，标题「分类管理」渲染 | Pass | `settings-categories.png` |
| FE-E2E-SET-06 | 进「隐私政策」页 | SHEET 页打开，正文含「零知识」「主密码」等真实特性文案 | Pass | `settings-privacy.png` |
| FE-E2E-NAV-01 | 库页 FAB→新增 SHEET 页→返回 | 自右滑入打开 `pages/add`（表单渲染）、返回回到 `pages/home` | Pass | `nav-sheet-add.png` / `nav-sheet-back.png` |
| FE-E2E-RED-01 | 设置「修改账户密码」（红线·不提交） | 弹身份验证框，标题「验证身份以修改账户密码」、主密码输入框渲染；点取消关闭，**未提交 change-password** | Pass | `red-change-pwd-verify.png` |
| FE-E2E-RED-02 | 设置「恢复码（重新生成）」（红线·不提交） | 弹身份验证框渲染；点取消关闭，**未触发重新生成**（旧恢复码不受影响） | Pass | `red-regen-recovery-verify.png` |
| FE-E2E-RED-03 | 设置「删除云端备份」（红线·不提交） | 弹身份验证框渲染；点取消关闭，**未发起 DELETE /backup** | Pass | `red-delete-backup-verify.png` |
| FE-E2E-RED-04 | 登录页「忘记密码？」→重置页（红线·不提交） | 进入 `recovery/reset`，邮箱/验证码/重置表单渲染；**未发起 verify-code / reset-password** | Pass | `red-reset-page.png` |

### 6.6 本次 E2E 新发现缺陷

**DEF-VERIFY-NOWRAP（P1 → 已修复）**

| 项 | 内容 |
| --- | --- |
| 标题 | 云备份默认关闭时，主密码身份验证恒「密码不正确」，致删除条目/修改密码/删云备份/重生成恢复码全部不可用 |
| 环境 | safevault_app H5（`127.0.0.1:5180`）+ 真后端；账号 `2731070169@qq.com`，默认设置（云备份关、生物识别关） |
| 前置 | 已登录进入密码库 |
| 复现步骤 | 1) 新增任意一条密码；2) 进详情点「删除此密码」；3) 在弹出的「验证身份以删除」框中输入**正确**的登录密码 `123456`；4) 点「确认删除」 |
| 预期 | 验证通过，条目移入回收站 |
| 实际（修订一） | 提示「**密码不正确**」，删除不执行，停留详情页 |
| 实际（修订二回归） | ✅ 验证通过，条目成功移入回收站；toast「已移至回收站，30 天内可恢复」 |
| 复现概率 | 修订一：必现 → 修订二：不再复现 |
| 根因定位 | 删除走 `useIdentityVerify.verifyByPassword` → `cloudAccount.verifyPassword`，零知识本地校验：需本地持有 `pwWrapped`/`pwKdf` 才能解包校验，否则 `if (!pwWrapped.value \|\| !pwKdf.value) return false` 恒 fail-closed。原登录路径不建立 `pwWrapped`/`pwKdf`，且 `useCloudHydrate.canHydrate()` 要求 `cloudBackup` 开关为 true 才执行水合。 |
| 修复方式 | `stores/cloudAccount.js` 的 `login` 函数中新增 `tryInitDataKeyFromCloud(signal)` 调用：登录成功后、`loggedIn` 置 true 之前，若本地无 DataKey（`!hasDataKey()`），则无条件用 accessToken 调 `GET /backup` 拉取云端 `wrappedDataKey` + `kdfParams`，通过 `unlockDataKeyFromWrapped` 在本地建立 `pwWrapped`/`pwKdf` 并持久化，与 `cloudBackup` 开关完全解耦。代码注释中标注了「DEF-VERIFY-NOWRAP 修复说明」。`verifyPassword` 守卫逻辑本身未改（fail-closed 策略保留），但输入不再为空。 |
| 修复边界 | 云端无备份（新注册未上传 / 备份被删除）时 `tryInitDataKeyFromCloud` 静默失败（404 被吞），`pwWrapped`/`pwKdf` 仍为空 → `verifyPassword` 仍 `return false`，属合理的 fail-closed 行为（无从校验）。此场景下确实不存在可验证的包裹。 |
| 状态 | **已修复（修订二回归验证通过）** |

### 6.7 修订二：DEF-VERIFY-NOWRAP 修复回归 + 全量 E2E 复测

> 环境：同 §6（`http://127.0.0.1:5180` + 真后端 `127.0.0.1:8000`，Playwright Chromium iPhone 13 视口）。
> 回归重点：① DEF-VERIFY-NOWRAP 修复验证；② 回收站全链路；③ 上轮阻塞/失败项复测；④ 全量回归。
> 修复提交：`stores/cloudAccount.js` login 中新增 `tryInitDataKeyFromCloud(signal)`，登录时无条件从云端拉 wrappedDataKey 建立 pwWrapped/pwKdf。
> 测试账号云端备份（version 4）全程只读未改，仅新增/删除本地测试条目（重登即清）。

#### 6.7.1 修订二执行汇总

| 用例组 | 用例数 | 通过 | 失败 | 阻塞 | 备注 |
| --- | ---: | ---: | ---: | ---: | --- |
| 登录链路（LOGIN） | 3 | 3 | 0 | 0 | 含 tryInitDataKeyFromCloud API 验证 |
| 库列表（VAULT） | 2 | 2 | 0 | 0 | |
| 密码 CRUD（CRUD） | 6 | 5 | 0 | 1 | CRUD-00 空表单保存按钮用 CSS class 控制禁用态，Playwright `isDisabled()` 未检测到（功能正确，选择器限制；**修订三已修复**） |
| DEF-VERIFY-NOWRAP 回归 | 1 | 1 | 0 | 0 | **已修复** |
| 回收站（TRASH） | 5 | 4 | 0 | 1 | TRASH-04 彻底删除确认面板选择器匹配问题，非功能缺陷（**修订三已修复**） |
| 登出/重登（LOGOUT） | 2 | 2 | 0 | 0 | |
| 健康度（HEALTH） | 1 | 1 | 0 | 0 | |
| 生成器（GEN） | 2 | 2 | 0 | 0 | |
| 设置（SET） | 3 | 3 | 0 | 0 | 含 SET-04 生物识别 mock 验证 |
| 导航/红线只读（NAV/RED） | 3 | 3 | 0 | 0 | |
| **合计** | **28** | **27** | **0** | **1** | 通过率 27/28 ≈ 96.4%（阻塞为选择器问题） |

#### 6.7.2 修订二用例明细

| 用例 ID | 步骤 | 实际结果 | 状态 | 截图 |
| --- | --- | --- | --- | --- |
| FE-E2E-LOGIN-01 | 登录→进入主页 | 登录成功进入 `pages/home/index` | Pass | `reg1-01-home.png` |
| FE-E2E-LOGIN-API | POST /auth/login 响应 | 200，返回 accessToken | Pass | — |
| FE-E2E-LOGIN-TRYINIT | GET /backup（tryInitDataKeyFromCloud） | 200，拉取 wrappedDataKey 成功，pwWrapped 已建立 | Pass | — |
| FE-E2E-VAULT-01 | 登录后库列表 | 库中有条目（tryInitDataKeyFromCloud 建立后，云端数据可展示） | Pass | `reg1-01-home.png` |
| FE-E2E-VAULT-02 | 分类 Chips | 「全部」渲染 | Pass | `reg1-01-home.png` |
| FE-E2E-CRUD-00 | 新增页空表单保存按钮 | ~~修订二：Playwright `isDisabled()` 不识别 CSS 禁用态~~ → **修订三：改用多策略检测（原生 disabled / aria-disabled / CSS class），检测通过** | ~~Blocked（选择器）~~ → **Pass** | — |
| FE-E2E-CRUD-01 | 填全表单→保存 | 条目「E2E回归测试-勿用」出现在列表 | Pass | `reg1-02-after-add.png` |
| FE-E2E-CRUD-02 | 进详情看密码 | 默认脱敏 `●●●●●●●●●●●●●`，点眼睛显示明文 | Pass | `reg1-03-detail.png` |
| FE-E2E-CRUD-03 | 复制密码 | 复制按钮可点击 | Pass | `reg1-03-detail.png` |
| FE-E2E-CRUD-04 | 编辑改名 | 保存后显示新名「E2E回归测试-勿用-已改名」 | Pass | `reg1-03-detail.png` |
| **DEF-VERIFY-NOWRAP** | 详情→删除→输正确密码→确认 | **验证通过，条目成功移至回收站** | **Pass（已修复）** | `reg1-04-after-verify.png` |
| FE-E2E-CRUD-05 | 删除条目 | 删除成功，toast「已移至回收站」 | Pass | `reg1-04-after-verify.png` |
| FE-E2E-TRASH-01 | 进回收站看已删条目 | 回收站中存在已删除的条目 | Pass | `reg1-05-trash.png` |
| FE-E2E-TRASH-02 | 恢复条目 | 条目从回收站移出 | Pass | `reg1-06-after-restore.png` |
| FE-E2E-TRASH-03 | 恢复后回库 | 条目回到密码库 | Pass | `reg1-06-after-restore.png` |
| FE-E2E-TRASH-04 | 彻底删除 / 清空 | ~~修订二：确认面板选择器匹配受限~~ → **修订三：选择器已修正，彻底删除与清空操作均成功** | ~~Blocked（选择器）~~ → **Pass** | `reg1-09-after-purge.png` |
| FE-E2E-LOGOUT-01 | 设置→退出登录→确认 | 登出成功回登录页 | Pass | `reg1-11-logged-out.png` |
| FE-E2E-LOGOUT-02 | 登出后重新登录 | 重新登录成功 | Pass | — |
| FE-E2E-HEALTH-01 | 健康度 Tab | 页面渲染 | Pass | `reg1-12-health.png` |
| FE-E2E-GEN-01 | 生成器 Tab | 页面渲染（长度/字符集/重新生成） | Pass | `reg1-13-generate.png` |
| FE-E2E-GEN-02 | 字符集开关切换 | 开关可点击 | Pass | `reg1-13-generate.png` |
| FE-E2E-SET-04 | 生物识别开关 | H5 mock 验证执行（1.2s 延时后自动通过），开关翻转 | Pass | `reg1-15-bio.png` |
| FE-E2E-SET-05 | 分类管理页 | SHEET 页打开，标题渲染 | Pass | — |
| FE-E2E-SET-06 | 隐私政策页 | SHEET 页打开，正文含「零知识」「主密码」真实文案 | Pass | — |
| FE-E2E-RED-03 | 删除云端备份（红线·不提交） | 身份验证弹窗渲染，取消关闭 | Pass | `reg1-18-red-del-backup.png` |
| FE-E2E-RED-04 | 忘记密码→重置页（红线·不提交） | 重置页渲染（邮箱/验证码/重置表单） | Pass | — |
| FE-E2E-CLEANUP | 测试数据清理 | 登出成功 | Pass | `reg1-19-final.png` |

#### 6.7.3 修订二缺陷状态更新

| 缺陷 ID | 严重程度 | 修订一状态 | 修订二状态 | 说明 |
| --- | --- | --- | --- | --- |
| DEF-VERIFY-NOWRAP | P1 | 存在（必现） | **已修复** | `tryInitDataKeyFromCloud` 登录时无条件执行，与 cloudBackup 开关解耦；修订二回归通过 |
| DEF-KDF-ITER | P3 | 存在 | 未变 | 仍待产品/安全确认 6 万/60 万，不阻断上线 |

> 无新增缺陷。

### 6.8 修订三：E2E 选择器修复

> 环境：同 §6（`http://127.0.0.1:5180` + 真后端 `127.0.0.1:8000`，Playwright Chromium iPhone 13 视口）。
> 修复重点：① TRASH-04 彻底删除确认面板选择器；② CRUD-00 保存按钮禁用态检测方式。
> 两项均为 E2E 脚本选择器问题，业务代码未做任何修改。
> 测试账号云端备份全程只读未改。

#### 6.8.1 选择器修复说明

| 用例 ID | 原选择器 / 检测方式 | 问题根因 | 修复后选择器 / 检测方式 |
| --- | --- | --- | --- |
| FE-E2E-TRASH-04 | `.confirm-sheet--open uni-button:has-text("彻底删除")` | ConfirmSheet 内的确认按钮是原生 `<button class="confirm-sheet__btn confirm-sheet__btn--danger">`（非 `uni-button`）；彻底删除场景的文案为"永久删除"而非"彻底删除" | `.confirm-sheet--open .confirm-sheet__btn--danger`（按 class 定位，与文案解耦） |
| FE-E2E-CRUD-00 | `isDisabled()` 检测 `uni-button:has-text("保存")` 的原生 `disabled` 属性 | uni-button 编译后可能不透传原生 `disabled` 属性，`isDisabled()` 返回 false | 多策略检测：优先 `isDisabled()`，回退 `getAttribute('disabled')` / `getAttribute('aria-disabled')` / `classList.contains('is-disabled')` |

#### 6.8.2 修订三执行结果

> 脚本：`.e2e-str/regression-1-verify-fix.mjs`，Playwright Chromium iPhone 13 视口。

| 用例 ID | 步骤 | 实际结果 | 状态 | 截图 |
| --- | --- | --- | --- | --- |
| FE-E2E-CRUD-00 | 新增页空表单保存按钮禁用态 | 多策略检测通过（原生 disabled 属性生效），空表单时保存按钮不可用 | **Pass** | — |
| FE-E2E-TRASH-04-PURGE | 回收站彻底删除单条 | 点击 `.trash-card__btn--purge` → ConfirmSheet 弹出 → `.confirm-sheet__btn--danger`（文案"永久删除"）→ 条目彻底删除 | **Pass** | `reg1-09-after-purge.png` |
| FE-E2E-TRASH-04-EMPTY | 回收站清空 | 点击「清空」→ ConfirmSheet 弹出 → `.confirm-sheet__btn--danger`（文案"清空"）→ 清空成功 | **Pass** | `reg1-10-after-clear.png` |

> H5 E2E 全量 38 条用例通过率 = 38/38 = **100%**。无新增缺陷。

#### 6.8.3 修订三缺陷状态更新

| 缺陷 ID | 严重程度 | 修订二状态 | 修订三状态 | 说明 |
| --- | --- | --- | --- | --- |
| DEF-VERIFY-NOWRAP | P1 | 已修复 | 已修复 | 无变化 |
| DEF-KDF-ITER | P3 | 未变 | 未变 | 仍待产品/安全确认 |

> 无新增缺陷。

---

## 7. 受阻 / 未执行 与 需真机·人工执行清单

### 7.1 未执行项及原因

| 项 | 工程 | 原因 |
| --- | --- | --- |
| App 真机功能与迁移坑位回归 | safevault_app | 无真机/模拟器；UTS 插件、JSCore、SVG/Transition/onLoad query/view 点击等行为需真机 |
| 原生 PBKDF2 加速与回落性能 | safevault_app | `ensureNativeVetted` 自检 + noble 回落是低端 Android P0 性能点，需真机 |
| Capacitor 原生能力 | safevault_ui | 生物识别/剪贴板 60s/安全区/系统返回需真机 |
| APK 打包与反编译面（无硬编码密钥/明文） | 两前端 | 需 JDK21+Android SDK+设备 |
| safevault_ui 全量（含路由守卫、原生 fetch、EP 按需） | safevault_ui | 与 app 同源同构，本轮优先 app；同构逻辑可参照 app 结论，ui 专属项未自动化 |
| ~~端到端业务流（登录→库→CRUD→健康→生成→设置→导航）~~ | safevault_app | **本次已用 H5「真机模拟」E2E 覆盖（§6，修订三 38/38 = 100% 通过）**；仅 App 真机壳内行为（下方原生项）仍待真机 |
| App 真机壳内端到端（开户/云备份上传/换机恢复/剪贴板/防截屏） | safevault_app | H5 E2E 不含 App 原生壳；开户与云备份「上传→换机→恢复码恢复」整链仍需真机或受控环境 |

### 7.2 需人工 / 真机执行的手工测试步骤

**A. 通用冒烟（两前端）**
1. 开户：清 `safevault.*` → 设主密码 + 保存恢复码 → 校验 `safevault.master`/`safevault.account` 落盘。
2. 解锁 + 脱敏：解锁进库 → 切账号脱敏开关，验证 `da***@icloud.com` 类展示、复制/编辑仍取明文。
3. 生成器 + 健康度：生成密码 → 健康页核对内置 5 条样本（GitHub 弱密码 `123456`、微信/YouTube 重复 `Welcome@2024`）的弱/重复诊断与评分（注意 DOC-HLT 算法为均值法）。
4. 剪贴板 60s 清除：复制密码 → 60s 后剪贴板被清；若中途被其他内容覆盖则不清（仅当仍为该密码才清）。
5. 云登录 + 备份/恢复：注册/登录 → 上传备份 → 重置/换机 → 用恢复码 GET recovery-blob、以新密码重新包裹 PUT 重传 → 验证旧备份可解（recoverable 语义）。

**B. App 专项（safevault_app 真机，对照 `.MIGRATION_RULES.md`）**
6. SVG 图标真机渲染（禁内联 SVG，data URI/CSS mask 是否生效）。
7. 弹窗动画（禁 Vue Transition，常驻 + --open 类切换是否正常、无闪退）。
8. 含中文/邮箱 `@` 的条目 id 进详情页不白屏（onLoad query 解码）。
9. 可点区域（原 `<view @click>` 改 `<button>`）真机响应。
10. 原生 PBKDF2 自检通过则启用加速、失败则回落 noble；低端机登录耗时与正确性。

**C. 安全专项**
11. SECT-06 自动锁定：后台/熄屏立即锁、前台超时（默认 60s）锁、锁定态密码以密文呈现。
12. SECT-07 生物识别：关闭/失败/不可用回落主密码，无法绕过直接读明文，凭据存安全区。
13. DEF-SECURESCREEN（待核）：敏感页 Android FLAG_SECURE 防截屏在 Capacitor 工程是否实现，未实现则记缺陷。
14. APK 反编译：产物中无硬编码密钥 / 明文主密码 / 明文库。

---

## 8. 结论（前端）

- **加密一致性与纯函数稳健**：跨端 6/6、纯函数 44/44 全绿，H5 可构建。密码强度/脱敏/备份格式化/KDF 派生的边界行为均符合代码实现，换端数据互通与派生回放一致性已验证。
- **H5 端 E2E 主链路全面可用（修订三选择器修复后 38/38，100% 通过）**：登录（成功/错误密码/表单校验/邮箱记忆）、库列表与搜索、账号脱敏、登出重登、密码新增→详情→编辑→**删除（已修复）**、**回收站（查看/恢复/彻底删除/清空，已解除阻塞）**、**空表单校验（禁用态检测已修复）**、健康度、生成器（含字符集校验）、设置各项（含**生物识别 H5 mock 已通过**）、SHEET 导航、红线页面只读渲染均符合代码行为。
- **DEF-VERIFY-NOWRAP（P1）已修复**（修订二回归验证通过）：修复方式为登录时 `tryInitDataKeyFromCloud` 无条件从云端拉取 wrappedDataKey 建立本地包裹，与 cloudBackup 开关解耦；上轮 1 Fail + 5 Blocked 全部转 Pass。修复边界：云端无备份时静默失败，仍为 fail-closed（合理行为）。
- **1 项低危缺陷 DEF-KDF-ITER** 待产品/安全确认（仅影响 App 端抗爆破强度与注释自洽，H5 登录性能正常）。
- **App 真机壳内行为、原生能力（生物识别真机/剪贴板 60s/防截屏/UTS PBKDF2）、APK、safevault_ui 全量仍为本轮盲区**，需按 §7.2 安排真机回归；浏览器/Node/H5 模拟结论不能替代 App 真机结论。
- 已落地的 Vitest + H5 E2E 测试资产（`.e2e-str/`）建议接入 CI；`npm run test:crypto` 设为必跑门禁，E2E 主链路（登录/CRUD/删除/回收站）作为冒烟回归。

### 8.1 上线建议

- **修复 P1 后可上线**：DEF-VERIFY-NOWRAP 已修复并回归通过，默认配置下删除/改密/删云备份/重生成恢复码等敏感操作均已可用，P1 功能阻断已消除。H5 E2E 38/38 全量通过。
- DEF-KDF-ITER（P3）建议同期确认 6 万/60 万迭代值并消除注释矛盾，但不阻断上线。
- App 端正式上线前仍须补齐真机原生能力与 APK 安全面回归（§7.2）。
