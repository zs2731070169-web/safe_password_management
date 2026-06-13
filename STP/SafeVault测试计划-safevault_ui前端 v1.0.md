# SafeVault 软件测试计划（STP）· 分册三：safevault_ui 前端（Vue Router + Capacitor）

> 被测对象：`safevault_ui/`（Vue 3 · Vite 5 · Vue Router 4 · Pinia · Element Plus 按需 · Sass · Capacitor 8 Android 壳）
> 上位文档：`STP/SafeVault测试计划-主文档 v1.0.md`
> 关联分册：`STP/SafeVault测试计划-safevault_app前端 v1.0.md`（本分册采用**差异化**写法，与 app 同构的用例不重复，仅列差异）

---

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | STP-SAFEVAULT-UI |
| 版本号 | v1.0 |
| 编制人 / 日期 | 待填 / 2026-06-13 |

### 修订记录

| 版本 | 日期 | 修订人 | 说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-13 | 待填 | 首次建立，以与 app 分册的差异为主体 |

---

## 1. 定位：与 safevault_app 的关系

`safevault_app` 由 `safevault_ui` 迁移而来，二者在业务层**高度同构**：

| 共有同名模块 | stores | utils | composables | services |
| --- | --- | --- | --- | --- |
| 一致 | vault / health / generator / settings / cloudAccount | kdf / passwordStrength / maskAccount / formatBackup | useVault / useHealth / useGenerator / useSettings / useCloudAccount / useCloudBackup / useAutoLock / useBiometricPrompt / … | crypto / http / cloudBackup / localVault / secureCredential / biometric / clipboard / imageSaver |

因此 **app 分册 §4（单元）、§5.2（composable+store+service 集成）、§6（业务流程 E2E）、§7（安全）的用例对 ui 同样适用**，可直接复用其用例 ID 体系（在 ui 执行时前缀改为 `UI-`，如 `UI-UT-KDF-01`、`UI-E2E-ONB-01`），**本分册不再重复罗列**，只描述**运行环境与实现差异带来的不同测试项**。

### 1.1 关键差异一览（决定差异化用例）

| 维度 | safevault_app | safevault_ui（本工程） | 对测试的影响 |
| --- | --- | --- | --- |
| 运行环境 | uni-app App(JSCore)+H5 双端 | 浏览器 H5 + Capacitor WebView（Android） | ui 全程跑 WebView/浏览器，**WebCrypto 原生可用** |
| 加密底座 | noble + cryptoPolyfill 垫片 + UTS 原生 PBKDF2 | **`window.crypto.subtle` 原生 WebCrypto**（`services/crypto.js`/`utils/kdf.js`） | **无跨端 noble↔WebCrypto 一致性问题、无 UTS 插件回落测试** |
| 网络 | `uni.request`（`services/http.js`） | **原生 `fetch`**（`services/http.js`，`BASE_URL=VITE_API_BASE_URL+API_ROOT`） | 测试关注 fetch 封装、AbortSignal、基地址注入 |
| 路由 | uni pages.json + `utils/navigation`/`guard` 垫片 | **Vue Router 4**（`router/index.js`：`beforeEach` 守卫、`SHEET_ROUTES`、过渡方向） | 路由守卫与导航过渡是 ui 专属测试重点 |
| 原生能力 | uni 生命周期/插件 | **Capacitor 8**：`@capacitor/clipboard`、`@capgo/capacitor-native-biometric`、`@capacitor-community/media`、`@capacitor/app`；`services/appBack.js`、`useSystemBack`、`useSwipeNav` | Capacitor service 边界与 APK 真机测试 |
| UI 组件库 | 自定义 | Element Plus 按需（仅 ElMessage/ElMessageBox/ElInput 等少量） | EP 按需 CSS 注入正确性 |
| 打包 | uni 基座/云打包 | **`build-apk.sh`（Capacitor + Gradle，JDK 21）** → `apk-output/` | APK 构建与安装、反编译面 |
| 专属 composable | — | `useSwipeNav`、`useSystemBack` | 手势返回与系统返回键测试 |

### 1.2 实现现状核对

- 与 app 分册 §1.1 相同的偏差项 **DEF-REC / DEF-HLT / DEF-STR / DEF-TRASH** 在 ui 同样存在（同源代码），处置一致：按代码实际定基线、向产品澄清。
- ui 的 `services/crypto.js` 注释明确「仅依赖标准 WebCrypto，Capacitor WebView 与现代浏览器均支持」，故不存在 app 端 JSCore 缺 WebCrypto 的问题。

---

## 2. 工具与框架（差异）

| 用途 | app | ui（本工程） |
| --- | --- | --- |
| 单元 | Vitest（建议） | **Vitest（建议）**，纯函数/store/composable 可在 jsdom 直跑（WebCrypto 在 jsdom 需 polyfill 或用 Node webcrypto） |
| 跨端一致性 | crypto-parity 必跑 | **不适用**（单端 WebCrypto） |
| 路由测试 | navigation 垫片 | **Vue Router 守卫单测**（mock store 状态驱动 `beforeEach`） |
| E2E | Playwright(H5)+真机 | **Playwright（浏览器/WebView）+ Capacitor APK 真机** |
| 打包验证 | uni 基座 | `npm run apk` / `apk:install` / `apk:release` |

---

## 3. 差异化测试项与用例清单

> 用例 ID：`UI-*`。仅列与 app 不同的项；同构项按 §1 复用 app 分册并改前缀执行。

### 3.1 路由守卫与导航（Vue Router 专属，`router/index.js`）

| 用例ID | 场景 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| UI-ROUTE-01 | 未开户拦截 | `auth.hasMasterPassword=false` 时访问任意路由（含 /unlock、找回页） | `beforeEach` 一律重定向至 `/onboarding` | P0 |
| UI-ROUTE-02 | 未解锁拦截 | 已开户未解锁访问 `requiresUnlock:true` 路由（/vault、/detail 等） | 重定向回 `/unlock` | P0 |
| UI-ROUTE-03 | 守卫同步判定 | 启动即从 localStorage 同步读 `hasMasterPassword` | 守卫无需异步等待即可判定 | P1 |
| UI-ROUTE-04 | SHEET_ROUTES 前进打开 | 进入详情/新增/编辑/改密/恢复码/回收站 | `outerTransition=sheet-right` 自右滑入 | P1 |
| UI-ROUTE-05 | SHEET_ROUTES 关闭返回 | 从弹出页后退 | `sheet-close` 向右滑回；左滑手势可反向收回（`useSheetDismiss`） | P1 |
| UI-ROUTE-06 | Tab 间过渡方向 | 在 vault/health/generate/settings 间切换 | 按 `constants/tabs.js` 顺序决定左右滑（`routeTransition`） | P2 |
| UI-ROUTE-07 | 路由注册顺序敏感 | 访问 `/vault/add`、`/vault/:id/edit`、`/vault/:id` | add/edit 不被动态段 `:id` 误匹配 | P0 |
| UI-ROUTE-08 | 全屏布局 | 开户/解锁/主密码/找回/重设页 | `fullscreen` 不在 MainTabLayout 外壳内 | P2 |
| UI-ROUTE-09 | 常驻外壳 | 四 Tab | MainTabLayout 顶栏+底栏常驻，URL 为 /vault 等 | P2 |

### 3.2 网络层（原生 fetch 封装，`services/http.js`）

| 用例ID | 场景 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| UI-HTTP-01 | 基地址注入 | 设/不设 `VITE_API_BASE_URL` | 正确拼 `BASE_URL+API_ROOT+path`；尾斜杠归一 | P1 |
| UI-HTTP-02 | AbortSignal 取消 | 请求中途 abort | 抛 `AbortError`，调用方可识别取消 | P1 |
| UI-HTTP-03 | 错误响应处理 | 4xx/5xx/网络错 | 统一错误结构，业务可读 status 与文案 | P1 |
| UI-HTTP-04 | 鉴权头 | 受保护接口 | 携带 `Authorization: Bearer access` | P0 |

### 3.3 Capacitor 原生能力（`services/*` + 专属 composable）

| 用例ID | 场景 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| UI-CAP-CLIP-01 | 剪贴板（`clipboard.js`，@capacitor/clipboard） | APK 真机复制密码 | 复制成功；60s 后清空（仍为该内容才清）；浏览器降级 execCommand 可用 | P0 |
| UI-CAP-BIO-01 | 生物识别（`biometric.js`，capacitor-native-biometric） | 真机开启/解锁 | 调系统指纹/面容；失败回落主密码；浏览器走 mock | P0 |
| UI-CAP-MEDIA-01 | 恢复码存图（`imageSaver.js`，@capacitor-community/media） | 恢复码页「保存为图片」 | 真机存入相册；浏览器降级方案可用 | P1 |
| UI-CAP-BACK-01 | 系统返回键（`appBack.js`/`useSystemBack`，@capacitor/app） | Android 物理返回键 | 按层级返回；根 Tab 双击退出等逻辑符合实现 | P1 |
| UI-CAP-SWIPE-01 | 手势返回（`useSwipeNav`） | SHEET 页左滑/右滑边缘手势 | 反向收回弹出页，不误触 | P2 |

### 3.4 Element Plus 按需（`main.js`）

| 用例ID | 场景 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| UI-EP-01 | 按需 CSS | 触发 ElMessage/ElMessageBox/ElInput | 样式正常（`main.js` 已手动补 `el-xxx.css`），无样式丢失/错位 | P1 |
| UI-EP-02 | 原生表单控件 | 开关/滑块/单选 | 均为原生 `<input>`+自定义 CSS，**未误用** el-switch/el-slider | P2 |

### 3.5 APK 打包与安装（`build-apk.sh`）

| 用例ID | 场景 | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| UI-APK-01 | 调试包构建 | `npm run apk`（JDK 21 + Android SDK） | 出带调试签名 APK，归档 `apk-output/`，可直接装机 | P0 |
| UI-APK-02 | 装机启动 | `npm run apk:install`（USB） | 安装并启动，重定向解锁/开户流程正常 | P0 |
| UI-APK-03 | 正式包签名 | `npm run apk:release`（KEYSTORE_PATH 等环境变量） | 正式签名 APK 产出，可安装 | P1 |
| UI-APK-04 | 真机全流程冒烟 | 装机后跑开户→解锁→增改→生成→（联调）云备份 | 核心流程在 Capacitor WebView 正常 | P0 |

---

## 4. 端到端测试（复用 + 真机补充）

- **复用** app 分册 §6 的 `*-E2E-*` 流程（开户/解锁/增删改/脱敏复制/生成器/分类搜索/健康度/云全链路/忘记密码恢复/自动锁定），在 ui 上以 `UI-E2E-*` 前缀执行，运行载体为浏览器 + Capacitor APK 真机。
- **ui 专属真机补充**：UI-CAP-* 系列（剪贴板/生物识别/存图/系统返回/手势）+ UI-APK-* 系列，必须在 Android 真机执行，浏览器无法覆盖。
- **不需要** app 的迁移坑位回归（FE-APP-*，那是 uni-app 专属）与跨端一致性（FE-PARITY-*）。

---

## 5. 安全测试（差异，落主文档 §10）

> 与 app 分册 §7 同构的安全项（零知识抓包、KDF、脱敏、剪贴板、自动锁定、生物识别、日志、恢复码）复用执行；以下为 **Capacitor/APK 专属** 差异项。

| 用例ID | 对应 SECT | 步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- |
| UI-SEC-APK-01 | SECT-11 | 对 release APK 反编译（jadx 等） | 无硬编码后端密钥、无明文主密码、无嵌入式凭据；建议开启代码混淆 | P0 |
| UI-SEC-APK-02 | SECT-11 | 检查 `secureCredential.js` 落地 | 生物识别凭据经安全存储（Keystore），非明文持久化 | P0 |
| UI-SEC-FLAG-01 | PRD §5.1.4 | 敏感页截图/录屏 | 期望 Android `FLAG_SECURE` 防截屏（**核对实现现状**，若未实现记为缺陷 DEF-SECURESCREEN） | P1 |
| UI-SEC-HTTPS-01 | SECT-03 | APK 直连后端 | `VITE_API_BASE_URL` 为 HTTPS；不允许明文 HTTP 传 token/密文 | P0 |
| UI-SEC-WV-01 | SECT-03 | WebView 配置 | 不开启不必要的调试/混合内容；不暴露危险 JS Bridge | P1 |

---

## 6. 通过准则与门禁

**Entry：** H5 可 `npm run dev` 启动并过冒烟；`npm run apk` 能出可装机调试包。

**Exit：**
- 复用的 app 同构用例在 ui 全部通过（前缀 `UI-`）；ui 专属（路由守卫、fetch、Capacitor、EP、APK）用例 P0/P1 100% 通过。
- Vitest 纯函数/加密覆盖 ≥ 90%（与 app 一致）；路由守卫关键分支有单测覆盖。
- APK 反编译面检查无硬编码密钥/明文凭据；遗留 P0/P1 = 0。
- DEF-REC/DEF-HLT/DEF-STR/DEF-TRASH 与 DEF-SECURESCREEN（若命中）已澄清有结论。

```bash
# 本工程目录下
npm run dev                 # H5 冒烟
npx vitest run --coverage   # 单元（建议引入）
npm run apk:install         # 真机安装跑 UI-CAP-*/UI-APK-* 与真机 E2E
```

---

## 7. 风险（ui 侧，细化主文档 §6）

| 风险 | 缓解 |
| --- | --- |
| 路由注册顺序回归（add/edit 被 :id 误匹配） | UI-ROUTE-07 纳入回归必跑；改路由表后强制重测 |
| Capacitor 原生能力在浏览器走 mock，真机行为不同 | UI-CAP-* 必须真机执行，不以浏览器结论替代 |
| APK 反编译暴露逻辑/未混淆 | UI-SEC-APK-01 专项；release 流程要求混淆 |
| EP 按需 CSS 漏注入致样式错乱 | 新引入 EP 组件时补 `el-xxx.css` 并回归 UI-EP-01 |
| 与 app 同源代码的偏差项（DEF-*）双工程一致存在 | 偏差澄清结论同时回灌两个工程，避免修一处漏一处 |
