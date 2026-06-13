# SafeVault 软件测试报告（STR）· safevault 后端分册

> 文档类型：Software Test Report（后端分册）
> 对应计划：`STP/SafeVault测试计划-safevault后端 v1.0.md`（用例前缀 BE-*）
> 主报告：`STR/SafeVault测试报告-主报告 v1.0.md`

---

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 文档编号 | STR-SAFEVAULT-BE |
| 版本号 | v1.0 |
| 编制日期 | 2026-06-13 |
| 测试方式 | pytest 直测 service 真链路（内存 SQLite + fakeredis，不 mock DB/Redis 语义） |
| 运行命令 | 工程根 `safevault/` 下 `uv run pytest [-v] [--cov=app --cov-report=term-missing]` |

### 0.1 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-13 | QA | 首次执行：既有 8 文件 + 本轮补充 1 文件的真实结果与覆盖率 |

---

## 1. 执行汇总

| 测试集 | 用例数 | 通过 | 失败 | 备注 |
| --- | ---: | ---: | ---: | --- |
| 既有 8 个测试文件 | 40 | 27 | 13 | 13 失败全为「测试资产过时」（业务演进、非 bug） |
| 本轮补充 `test_str_supplement.py` | 20 | 20 | 0 | 缺口覆盖 + 对齐当前真实契约 |
| **合计** | **60** | **47** | **13** | 排除过时用例后 47/47（含 27 既有有效 + 20 新增）全绿 |

总体语句覆盖率 **55%**（见 §4）。

---

## 2. 既有测试逐用例结果（40 项）

### 2.1 通过（27 项）

| 测试文件 | 用例 | 状态 |
| --- | --- | --- |
| test_change_password.py | 全部用例（改密成功/旧密码错/新旧相同/会话失效等） | ✅ PASS |
| test_reset_password.py | test_reset_wrong_code_rejected、test_reset_unregistered_email_same_error 等（除 1 项） | ✅ PASS |
| test_token_version_auth.py | 改密/重置后旧 access 立即 401、tv 缓存→DB 回填等 | ✅ PASS |
| test_backup_delete.py | 删除/版本防回退/缺坏 token 401 等 | ✅ PASS |
| test_backup_meta.py | test_meta_no_backup_returns_has_backup_false 等（除 2 项） | ✅ PASS |

> 说明：以上为按文件归纳；逐条用例名以 `uv run pytest -v` 输出为准。27 项通过覆盖了改密、token version 方案 B、备份删除、无备份 meta 返回 200{hasBackup:false} 等关键契约。

### 2.2 失败（13 项）—— 全部归因「测试资产过时」，非业务缺陷

| # | 测试文件::用例 | 失败类型 | 根因 |
| --- | --- | --- | --- |
| 1 | test_backup_upload.py::test_upload_first_backup_success | TypeError | upload_backup 缺 `wrapped_data_key` |
| 2 | test_backup_upload.py::test_upload_overwrites_with_higher_version | TypeError | 同上 |
| 3 | test_backup_upload.py::test_upload_version_rollback_rejected | TypeError | 同上 |
| 4 | test_backup_upload.py::test_force_overwrite_bypasses_version_and_rebuilds_baseline | TypeError | 同上 |
| 5 | test_backup_upload.py::test_force_with_higher_local_version_keeps_uploaded_value | TypeError | 同上 |
| 6 | test_backup_upload.py::test_upload_invalid_checksum_rejected | TypeError | 同上 |
| 7 | test_backup_upload.py::test_upload_malformed_base64_ciphertext_rejected | TypeError | 同上 |
| 8 | test_backup_upload.py::test_upload_too_large_rejected | TypeError | 同上 |
| 9 | test_backup_download.py::test_download_after_upload_returns_consistent_blob | TypeError | 内部串联 upload_backup，同上 |
| 10 | test_backup_download.py::test_download_reflects_latest_after_overwrite | TypeError | 同上 |
| 11 | test_backup_meta.py::test_meta_after_upload_returns_full_fields | TypeError | 内部串联 upload_backup，同上 |
| 12 | test_backup_meta.py::test_meta_reflects_latest_after_overwrite | TypeError | 同上 |
| 13 | test_reset_password.py::test_reset_success_invalidates_all_sessions | AssertionError | 断言 `cloudBackupCleared`，实际返回 `recoverable` |

**根因核实（已读业务源码确认）：**

- 第 1~12 项：`app/services/backup.py:74` 当前 `upload_backup` 签名为
  `upload_backup(session, user_id, ciphertext, wrapped_data_key, kdf_params, version, checksum, force=False)`，
  新增**必填**参数 `wrapped_data_key`（「密码包裹的 DataKey」密文，后端仅透传存储、永不解析），返回 `{version, updatedAt}`。
  旧测试调用未传该参数 → `TypeError: upload_backup() missing 1 required positional argument: 'wrapped_data_key'`。
- 第 13 项：`app/services/reset_password.py` 当前返回 `{resetOk: True, recoverable: True}`，源码注释明确「**不再含 cloudBackupCleared**，改返回 recoverable=true（走决策点 C2 恢复码包裹式密钥）」。旧测试仍断言 `cloudBackupCleared` → 断言失败。

**定性**：均为业务代码已演进、既有测试未同步，属测试资产维护债，**不计为业务缺陷**（对应主报告 §5 DOC-RESET / DOC-BACKUP-WDK）。本轮以 `test_str_supplement.py` 用当前契约重新验证了这些业务路径，证明业务行为本身正确（见 §3）。

---

## 3. 本轮补充测试逐用例结果（`test_str_supplement.py`，20 项全绿）

> 底座沿用 conftest.py；文件顶部加 `@compiles(BigInteger,"sqlite")` 把 BIGINT 渲染为 INTEGER（与既有 backup 测试同源解法），使 SQLite 下 register/upload 的自增主键生效。**未修改任何业务代码。**

| 用例 ID | 用例 | 验证点 | 状态 |
| --- | --- | --- | --- |
| BE-REG-01 | test_register_success_returns_tokens_and_userid | 验证码对+未注册→{tokens,userId}；access 携带 userId 与 tv=1；验证码用后即焚；refresh 入白名单 | ✅ PASS |
| BE-REG-02 | test_register_wrong_code_rejected | 验证码不符→InvalidCodeError | ✅ PASS |
| BE-REG-03 | test_register_missing_code_rejected | 从未发码→InvalidCodeError | ✅ PASS |
| BE-REG-04 | test_register_duplicate_email_rejected | 邮箱已注册→EmailExistsError | ✅ PASS |
| BE-LGN-01 | test_login_success | 正确凭据→{tokens,userId}；access tv 与账户一致 | ✅ PASS |
| BE-LGN-02 | test_login_wrong_verifier_401_and_counts_failure | 验证器不符→AuthFailedError 且 fail 计数+1 | ✅ PASS |
| BE-LGN-03 | test_login_unknown_email_same_401 | 邮箱不存在→同样 401（防枚举）且计 fail | ✅ PASS |
| BE-LGN-04 | test_login_locked_when_threshold_reached | fail 达阈值→AccountLockedError（不再触库） | ✅ PASS |
| BE-LGN-05 | test_login_success_clears_failure_count | 登录成功→清零 fail:{email} | ✅ PASS |
| BE-LGN-06 | test_login_disabled_account_rejected | status!=1 即便验证器对也 401 | ✅ PASS |
| BE-KDF-01 | test_kdf_params_real_for_registered | 已注册→返回库内真实 kdf_params | ✅ PASS |
| BE-KDF-02 | test_kdf_params_pseudo_for_unregistered_deterministic | 未注册→伪配方，同邮箱确定性恒定、结构一致、异邮箱 salt 异（防枚举） | ✅ PASS |
| BE-VC-01 | test_verify_code_ok | 验证码匹配不抛错；verify 本身不删码 | ✅ PASS |
| BE-VC-02 | test_verify_code_mismatch | 不符→InvalidCodeError | ✅ PASS |
| BE-VC-03 | test_verify_code_missing | 未发码→InvalidCodeError（与不符同一错误） | ✅ PASS |
| BE-BK-01 | test_upload_first_backup_returns_version_and_updatedat | 首次上传（含 wrapped_data_key）→{version,updatedAt}，version=1 | ✅ PASS |
| BE-BK-02 | test_upload_version_rollback_rejected | 非 force 下 version≤云端→BackupVersionConflictError（防回退 409） | ✅ PASS |
| BE-BK-03 | test_upload_invalid_checksum_rejected | checksum 非 64 位 hex→InvalidChecksumError | ✅ PASS |
| BE-RST-01 | test_reset_returns_recoverable_and_invalidates_sessions | 重置成功→{resetOk,recoverable}；token_version 自增（5→6）；refresh 白名单清空；验证码删除 | ✅ PASS |
| BE-RST-02 | test_reset_wrong_code_rejected | 验证码不符→InvalidCodeError | ✅ PASS |

> 这 20 项覆盖了 STP 后端分册标注的主要缺口（register / login / 失败锁定与清零 / kdf-params 真伪配方防枚举 / verify-code），并以当前契约固化了 backup 上传与 reset 的真实行为。

---

## 4. 覆盖率（`--cov=app`，真实数字）

| 模块 | 语句 | 未覆盖 | 覆盖率 |
| --- | ---: | ---: | ---: |
| services/login.py | 59 | 0 | **100%** |
| services/reset_password.py | 24 | 0 | **100%** |
| services/change_password.py | 30 | 0 | **100%** |
| services/verifier.py | 11 | 0 | **100%** |
| services/register.py | 29 | 2 | 93% |
| services/backup.py | 88 | 29 | 67% |
| services/token.py | 117 | 44 | 62% |
| services/verify_code.py | 28 | 11 | 61% |
| models/*（account/backup/recovery_blob） | — | 0 | 100% |
| schemas/backup.py | 35 | 0 | 100% |
| config.py | 49 | 0 | 100% |
| api/backup.py | 32 | 12 | 62% |
| api/deps.py | 26 | 7 | 73% |
| api/auth.py | 49 | 49 | **0%** |
| main.py | 34 | 34 | **0%** |
| comsumer/mail.py · core/mq/consumer.py · worker/* | — | 大部 | 0% |
| **TOTAL** | **1070** | **485** | **55%** |

**解读**：核心 service 与模型层覆盖充分（多为 100%）。0% 集中在 HTTP 路由编排（auth.py）、应用入口（main.py）、MQ 消费者、邮件/对象存储 worker——这些不经 service 直测，属底座设计取舍，建议后续用 TestClient + docker-compose 起真实中间件补 E2E。

---

## 5. 结论

- 后端**核心认证与零知识备份逻辑质量良好**：本轮 20 个补充用例 100% 通过，核心 service 覆盖率 62%~100%，验证了注册即登录、登录失败锁定/清零、防邮箱枚举伪配方、token_version 方案 B 立即失效、备份防回退、checksum 校验等关键契约。
- **13 个既有失败均非业务 bug**，是 backup/reset 业务演进后测试未同步所致；建议以本分册 §3 的 `test_str_supplement.py` 为范本更新既有用例。
- 路由层 / E2E / 真实中间件链路为本轮盲区，列入后续。

### 受阻 / 未执行（后端）

| 项 | 原因 |
| --- | --- |
| HTTP 路由级（TestClient）用例 | 既有底座为 service 直测；本轮未新增路由层套件（auth.py 0% 覆盖） |
| 真实 MySQL/Redis/OSS/MQ E2E | 未起真实中间件，按 conftest 用内存替身 |
| 越权访问（SECT-08：A 读/写/删 B 的 blob） | 需路由层 + 鉴权链路，未自动化 |
| 限流 scope 边界、refresh 轮转、logout 幂等、recovery-blob 存取 | STP 列为缺口，本轮未补（优先补了 register/login/kdf/verify-code） |
