# SafeVault 云备份后端接入设计

> 文档性质：基于现有纯前端 UI 工程（`password_assistant_ui/`）的代码分析，给出接入后端所需的功能 / 接口清单。
> 核心约束：**密码在本地管理**；身份已统一为**云账户**；仅当用户开启「云备份」时，**新增 / 修改 / 永久删除 / 导入**才触发云端备份更新；**不涉及多设备同步**。
> 更新日期：2026-06-09

## 一、总体定位：零知识（Zero-Knowledge）加密备份，而非密码同步后端

约束「密码本地管理 + 仅开启云备份时上传 + 不涉及多设备同步」决定了后端**不是一个逐条 CRUD 的密码服务**，而是一个**加密 blob 托管服务**：

- 后端**永不接触明文**。App 信任徽章即「数据已本地加密·不上云」（见 `views/unlock/components/TrustBadge.vue`、`AboutCard.vue`），云备份必须延续该承诺，云端只存密文。
- 每次触发备份 = 把**整库快照**用云账户密码派生的密钥在本地加密成一个 blob，**覆盖式**上传。无多设备 → 无合并 / 冲突 / 增量同步协议。
- 因此 vault 的增删改本身**不需要逐条后端接口**，后端只需「存 / 取一个最新密文 blob + 元信息」。

与上一版的关键差异：**云账户身份已经在 UI 落地**（不再是缺口），且它**一物两用**——既是后端登录认证的凭据，又是本地派生加密密钥的来源（取代了原主密码，见模块 3 与第三节）。这也带来一个新张力：「邮箱验证码重置密码」与「零知识备份的可解密性」存在冲突，需专门决策（见决策点 C）。

---

## 二、需要新增的后端模块与接口

### 模块 1：云账户与认证

现状：`stores/cloudAccount.js` 已是应用的**唯一身份中枢**，邮箱 + 密码持久化在 `localStorage` 的 `safevault.cloud`（mock 明文），会话态 `loggedIn` 不持久化。store 已按对外签名预留好动作，**真实接入只替换文件末尾 mock 区**即可。各动作与后端接口一一对应：

| 接口 | 对应前端动作（`stores/cloudAccount.js`） | 触发点 |
| --- | --- | --- |
| `POST /auth/verify-code` | `sendVerifyCode(email)` | 创建账户 / 重置密码前下发邮箱验证码 |
| `POST /auth/register` | `register({ email, password, code })` | **开户**：创建云账户（注册成功即登录） |
| `POST /auth/login` | `login({ email, password })` | 解锁：已注册用户每次启动重新登录 |
| `POST /auth/refresh` | `refresh()` | 静默续签 token |
| （本地校验，亦可后端化） | `verifyPassword(password)` | 敏感操作二次确认（改密 / 删除等进入页时） |
| `POST /auth/change-password` | `changePassword(newPassword)` | 设置页「修改账户密码」 |
| `POST /auth/reset-password` | `resetPassword({ code, newPassword })` | 忘记密码：邮箱验证码重置 |
| `POST /auth/logout` | `logout()` | 设置页 / 账户卡片「退出登录」：吊销后端会话并清本地密钥 |

要点：

- **身份与云备份解耦**：开户即建账户，不等到「开启云备份」。云备份开关（`settings.cloudBackup`）此后只决定**是否把加密 blob 推上云**，不再承担「首次建立身份」职责。
- **会话不持久化**：`loggedIn` 启动恒为 `false`，每次冷启动须重新登录（密码或指纹）——后端 token 也应按此设计（refresh token 可留存，access token 短时效）。
- **路由守卫两闸**（`router/index.js`）：①`!hasAccount` → 强制 `Onboarding`（创建账户）；②`requiresUnlock && !loggedIn` → 回 `Unlock`（登录）。后端无需感知，但接口语义须支撑这两态。
- **登出（logout）≠ 锁定（lock）**：二者都清会话内存中的密钥并令 `loggedIn = false`、触发守卫②回 `Unlock`，但范围不同——**lock（自动锁定）只清会话密钥，保留后端会话**：refresh token 仍有效、本地仍留存，下次用密码 / 指纹可**快速重登**（无需重走 `/auth/login` 的密码验证）；**logout（退出登录）则连后端会话一并吊销**：调 `POST /auth/logout` 把该 refresh token 从 Redis 白名单 `SREM` 移除使其即时失效，并清除本地保存的 refresh token，下次**必须重新走 `/auth/login`**。logout 全程仍不接触任何明文 / 密钥，**不破坏零知识**——后端只删白名单条目，不触达 MasterKey / DataKey。
- **登出失败兜底（本地优先）**：`POST /auth/logout` 网络失败时，客户端**仍应本地完成登出**（清会话密钥 + 清本地 refresh token + 回登录页），保证本地登出即时生效；后端那条未及移除的白名单项可由 refresh token 自身的 30 天 TTL 自然过期兜底，不会造成长期残留。access token 因短时效（如 15min）让其自然过期即可；如需即时失效可选将其 jti 加入黑名单（本设计不展开）。

### 模块 2：加密备份 blob 存储（核心，唯一真正的业务后端）

| 接口 | 用途 | 对应前端触发 |
| --- | --- | --- |
| `PUT /backup` | 上传最新整库密文快照（覆盖式），body = `{ ciphertext, kdfParams, version, checksum }` | **新增** `vault.addEntry` / **修改** `vault.updateEntry` / **软删除** `vault.deleteEntry` / **恢复** `vault.restoreEntry` / **永久删除** `vault.purgeEntry` + `emptyTrash` / **导入** |
| `GET /backup` | 下载最新密文快照 | 重装 / 换机后「从云端恢复」 |
| `GET /backup/meta` | 仅取元信息（最后备份时间、大小、版本号） | 设置页展示「上次备份：刚刚」 |
| `DELETE /backup` | 删除云端备份 | 用户关闭云备份开关时 |

`PUT /backup` body 字段：

| 字段 | 含义 | 后端可读 |
| --- | --- | --- |
| `ciphertext` | 整库 JSON 经 AES-GCM 加密后的密文本体（真正的备份数据） | ❌ 永不解析 |
| `kdfParams` | 密钥派生配方（算法 / 盐 / 迭代参数），换机后据此重算出密钥 | ✅ 明文 |
| `version` | 单调递增版本号，服务端拒绝旧版本覆盖新版本（防回退） | ✅ |
| `checksum` | `ciphertext` 的哈希（如 SHA-256），校验传输 / 存储未损坏 | ✅ |

要点：

- **快照范围（决策点 B）**：`ciphertext` 解密后的整库 JSON **同时包含活跃条目与回收站条目**（回收站项保留 `deletedAt`），使「30 天可恢复」窗口在换机后延续。故软删除 / 从回收站恢复也改变快照、需触发上传。
- **覆盖式 + 防回退**：用单调 `version` / `updatedAt`，服务端拒绝旧版本覆盖新版本（防并发误写），但不做合并。
- **上传需防抖**：连续新增 / 编辑会高频触发，前端应 debounce（如 2–3s）后只传最终快照一次。
- **blob 归属云账户**：备份按模块 1 的账户 token 鉴权归属，重装 / 换机后用同一云账户登录即可定位 `GET /backup`。
- 服务端对 `ciphertext` 完全不透明，只校验大小上限、做存储与计费。

### 模块 3：忘记密码与数据可恢复性 ⚠️ 恢复码已移除，需重新决策

现状：前端已**删除整套恢复码体系**（`stores/recovery.js` 及相关页面），找回密码改为**邮箱验证码重置**（`resetPassword({ code, newPassword })`）。这简化了交互，但与零知识备份产生**直接冲突**，必须在接入云备份时正面处理：

- 云账户密码**一物两用**：既是后端登录凭据，又是本地派生 DataKey 包裹密钥的来源（见第三节）。
- 「邮箱验证码重置密码」天然只能重置**后端身份凭据**；它**无法**解开用旧密码包裹的云端 blob——后端不持有旧密码，也不该持有。
- 后果：用户忘记密码并重置后，若本地无已解密数据，则**云端 blob 不可解密 = 备份数据丢失**。

可选方案（**决策点 C，待定**）：

| 方案 | 机制 | 代价 |
| --- | --- | --- |
| C1 接受丢失 | 重置密码仅恢复登录能力；云端旧 blob 视为不可解密，提示用户「云备份将清空、需重新上传」 | 简单、纯零知识；但忘记密码即丢云备份，体验差 |
| C2 重新引入 key escrow | 注册时额外生成一份「恢复凭据」（恢复码 / 助记词）包裹 DataKey，存 `recovery-blob`；重置后用它解出 DataKey 再用新密码重新包裹 | 找回数据完整；但需把已删的恢复码 UI 部分加回 |
| C3 邮箱托管密钥 | 服务端为 DataKey 存一份由独立服务器密钥保护的副本，邮箱验证后下发 | 体验最好；但**破坏零知识**（服务端理论上能触达密钥），与信任徽章承诺冲突 |

> 倾向：若坚持信任徽章的零知识承诺，应选 **C1**（明确告知）或 **C2**（补回最小化的恢复凭据）；不建议 C3。该决策直接决定是否需要 `recovery-blob` 接口，故下表接口标注为「依 C 决策启用」。

| 接口 | 用途 | 启用条件 |
| --- | --- | --- |
| `POST /backup/recovery-blob` | 存一份「用恢复凭据包裹的 DataKey」副本（key escrow，仍是密文） | 仅 C2 |
| `GET /backup/recovery-blob` | 重置后用恢复凭据解出 DataKey，再解开 `GET /backup` 的 blob | 仅 C2 |

---

## 三、加密 / 密钥设计（约束上述所有接口的 body 形态）

建议前端补 `services/crypto.js` + `services/cloudBackup.js`，后端只配合存密文。云账户密码取代原主密码作为密钥派生源：

```
云账户密码 ──Argon2id──► MasterKey
                          ├─ 用于本地解锁 / 敏感操作校验（替换 cloudAccount mock 的明文比对）
                          └─ 包裹 ► DataKey（随机生成，真正加密库数据的密钥）

[若选 C2] 恢复凭据 ──Argon2id──► RecoveryKey ── 也包裹一份 ► DataKey（存 recovery-blob）

整库快照(JSON) ──AES-GCM(DataKey)──► ciphertext ──► PUT /backup
```

登录认证与加密密钥的分离：

- 后端登录用**密码验证器**（如 SRP，或「密码 + 服务端盐」的慢哈希），与 MasterKey **不同**派生路径——后端只验证身份，拿不到 MasterKey，零知识不破。
- `verifyPassword`（敏感操作二次确认）真实接入时走本地 MasterKey 重算校验，无需后端往返。

收益：

- **改账户密码**（`changePassword`）只需用新 MasterKey 重新包裹 DataKey 并重传 blob（DataKey 不变，无需重新加密整库），同时更新后端密码验证器。
- **忘记密码**：见决策点 C——C1 放弃旧 blob，C2 经 RecoveryKey 解出 DataKey。
- 后端始终只见密文与密码验证器，符合零知识承诺。

---

## 四、前端改造点（让 mock 边界对接后端）

遵循项目约定「只替换 store 末尾 `// 以下为 mock 实现` 区，对外 actions/getters 签名不变」：

1. **`stores/cloudAccount.js`** — 文件末尾 mock 区（`mockSendVerifyCode` / `mockRegister` / `mockLogin` / `mockVerifyPassword` / `mockChangePassword` / `mockResetPassword` / `mockRefresh`）改为：
   - 调后端 `/auth/*`；
   - 本地不再留明文密码（`safevault.cloud` 改存 refresh token + KDF 盐，密码仅在内存中用于派生 MasterKey）；
   - `login` / `register` 成功后派生并缓存 MasterKey（会话内存）；`lock`（自动锁定）时**仅清除会话密钥**（MasterKey / DataKey）并置 `loggedIn = false`，**保留 refresh token**（下次快速重登）；
   - `logout`（退出登录）需从当前「`logout = lock` 别名」升级为**真正的对外动作**（仍遵循「只改 mock 区、对外签名稳定」约定）：先调 `POST /auth/logout`（带 `Authorization: Bearer access` 与待吊销的 `refreshToken`）令后端会话即时失效，再清会话密钥**与本地持久化的 refresh token**（`safevault.cloud` 中的 `refreshToken`），最后置 `loggedIn = false` 回登录页；网络失败时**仍本地完成上述清理**（本地登出优先，后端白名单项靠 TTL 自然过期兜底）。
2. **`stores/vault.js`** — `addEntry` / `updateEntry` / `deleteEntry` / `restoreEntry` / `purgeEntry` / `emptyTrash` 成功后发「库已变更」事件；新建 `composables/useCloudBackup.js` 监听，若 `settings.cloudBackup` 为真则 debounce 后 `PUT /backup`（快照含回收站，见决策点 B）。
3. **导入功能尚不存在** — 设置页「加密导出 / 导入备份」目前是 `placeholder()` 占位（`SettingsView.vue` 第 90 行、`composables/useSettings.js`），**需前后端一起新建**：解析导入文件 → 批量写入 vault → 触发一次备份。
4. **忘记密码** — `resetPassword` 真实接入按决策点 C 处理：C1 在重置成功后清空云端 blob 并提示；C2 需把最小化的「恢复凭据」录入 / 校验 UI 加回（开户时生成、找回时输入）。
5. **设置页云备份开关** — `settings.cloudBackup` 从「纯本地 boolean」改为：开 → 首次全量 `PUT /backup`；关 → `DELETE /backup`。新增「上次备份时间 / 状态」展示（对接 `GET /backup/meta`）。云账户卡片（`CloudAccountCard.vue`）已展示登录态与脱敏邮箱，可顺带挂「上次备份」副信息。

---

## 五、明确**不需要**后端的部分（界定范围）

- 密码生成器（`stores/generator.js`，本地 crypto 随机）。
- 健康度检测 / 强度评估（`stores/health.js`、`utils/passwordStrength.js`，DRD 明确「检测全程本地、不上传密码」）。
- 自动锁定、账号脱敏、生物识别开关（`stores/settings.js`、`services/biometric.js`，本地偏好）。指纹仅作本地快速登录入口，不替代云账户身份。
- vault 增删改查、回收站逻辑本身（全本地；后端只在「新增 / 修改 / 软删除 / 恢复 / 永久删除 / 导入」后收一次含回收站的快照）。

---

## 六、已确认的关键决策与待定项

1. **决策点 A —— 云账户身份（已落地）**：采用**邮箱 + 验证码**注册（不使用匿名设备 ID），便于重装 / 换机后定位并找回备份。**前端已实现**为统一身份中枢。
2. **决策点 B —— 回收站纳入备份（已确认）**：云端快照**包含回收站条目**（保留 `deletedAt`，使「30 天可恢复」窗口在换机后延续）。因此除「新增 / 修改 / 永久删除 / 导入」外，**软删除（`deleteEntry`）、从回收站恢复（`restoreEntry`）也触发 `PUT /backup`**。
3. **决策点 C —— 忘记密码后的数据可恢复性（⚠️ 待定）**：恢复码已从前端移除、改为邮箱验证码重置，但这与零知识备份冲突。需在 C1（接受丢失，纯零知识）/ C2（补回最小化 key escrow）/ C3（邮箱托管密钥，破坏零知识）间定夺，**直接决定是否启用 `recovery-blob` 接口**。

---

## 附：接口清单速览

| 模块 | 方法 | 路径 | 是否零知识（仅密文） |
| --- | --- | --- | --- |
| 认证 | POST | `/auth/verify-code` | — |
| 认证 | POST | `/auth/register` | — |
| 认证 | POST | `/auth/login` | — |
| 认证 | POST | `/auth/refresh` | — |
| 认证 | POST | `/auth/change-password` | — |
| 认证 | POST | `/auth/reset-password` | — |
| 认证 | POST | `/auth/logout` | — |
| 备份 | PUT | `/backup` | ✅ |
| 备份 | GET | `/backup` | ✅ |
| 备份 | GET | `/backup/meta` | 元信息（无密码内容） |
| 备份 | DELETE | `/backup` | — |
| 恢复 | POST | `/backup/recovery-blob` | ✅（仅决策点 C 选 C2 时启用） |
| 恢复 | GET | `/backup/recovery-blob` | ✅（仅决策点 C 选 C2 时启用） |
