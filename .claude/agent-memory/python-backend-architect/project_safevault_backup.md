---
name: project-safevault-backup
description: SafeVault 模块2（加密备份 blob 存储）后端各接口的状态码语义区分、零知识边界与前后端打通约定
metadata:
  type: project
---

SafeVault **模块2（加密备份 blob 存储）** 后端位于 `safevault/`（FastAPI 异步分层 api/services/schemas/models/core/client，用 uv 管理，测试 `uv run pytest tests/`，pythonpath=app、asyncio_mode=auto）。前端在 `safevault_ui/`（Vue3 纯 JS + Pinia）。注意这是比认证模块记忆里写的 `password_assistant/` 更新的工程目录。实现按时序图 `SDD/SafeVault模块2-加密备份blob存储-时序图 v1.0.md` 逐节推进，注释标 autonumber 步骤号。

**已实现**：§1 上传 `PUT /backup`、§2 下载 `GET /backup`、§3 元信息 `GET /backup/meta`。§4 删除 `DELETE /backup` 尚未实现。三层落点：`api/backup.py` / `services/backup.py` / `schemas/backup.py`，ORM `models/backup.py` 的 `BackupBlob`（唯一键 uk_backup_account，每账户一份覆盖式）。

**关键易踩坑——各接口「无备份」时的状态码刻意不同**（务必区分，勿照搬）：
- §2 下载无备份 → **抛 `BackupNotFoundError`(404)**「云端暂无备份」（取内容无可取才 404）。
- §3 meta 无备份 → **不抛异常，返回 200 `{ hasBackup: false }`**（「查询是否有备份」，«没有» 是正常查询结果）。
所以 service 层 `get_backup_meta` 用 `select(version, size_bytes, updated_at)` 选列查询 + `one_or_none()`，None 时直接 `return {"hasBackup": False}`，**绝不**复用 download 的 404 逻辑。

**零知识与轻量原则**：§3 meta 只 SELECT 三列、**不拉 blob、不查 OSS**，响应**不含** ciphertext/checksum/kdfParams（那些属 §2 下载）。§1 上传 / §2 下载经手密文：上传 `_decode_ciphertext`（base64 解码存原始字节到 OSS）、下载取回字节重新 base64 编码返回，编解码对称；后端永不解析密文。

**camelCase↔snake_case 边界**：对外响应字段 camelCase（`updatedAt`/`size`/`hasBackup`），库列 snake_case（`updated_at`/`size_bytes`），转换在 service 边界完成。

**路由顺序**：`GET /backup/meta`（静态段）与 `@router.get("")`（精确匹配 `/backup`）不冲突，FastAPI 精确路径匹配，空路径只命中 `/backup`，放其后安全。

**测试体例**（`tests/test_backup_meta.py` 等）：双层——service 直测（业务逻辑）+ 最小 app+TestClient 鉴权边界（缺/错 token→401，覆盖 `get_session` 为 yield None 空会话、不触 lifespan）。SQLite 下需 `@compiles(BigInteger,"sqlite")` 把 BIGINT 渲成 INTEGER 让自增生效（BackupBlob id 由 service 内部建、测试无从赋值）。`get_backup_meta` 不调 OSS，但前置 `upload_backup` 要写 OSS，直测里给 `services.backup.put_object` 打 noop monkeypatch 即可（meta 自身不需要 fake_oss）。

**前端打通约定**（§3「上次备份：刚刚 · 12 KB · v8」）：
- `services/cloudBackup.js` 新增 `fetchBackupMeta`，复用 `getMetaWithAuthRetry`（带 access token、401 续签重试一次的统一模式，与 getWithAuthRetry/sendWithAuthRetry 同款）。无 404 特判（meta 无备份是 200 `hasBackup:false`），归一为 `status: 'ok'|'empty'|'skipped'`。**只读不写本地备份状态**（不 saveLocal，version 管理归 push/pull）。
- store `stores/cloudAccount.js`（身份中枢，无独立 backup store）持 `backupMeta` 内存缓存 + `loadBackupMeta` action，`lock()`/`logout()` 时清空（换账户后旧元信息不残留）。拉取失败静默吞掉、保留上次值（副信息不阻断页面）。
- `composables/useSettings.js` onMounted 拉取（AbortController，onUnmounted 取消），派生 `backupSummary` 经 `utils/formatBackup.js`（`formatSize` 1024 进制、`formatRelativeTime` 刚刚/分钟/小时/天/日期、`formatBackupSummary` 拼装）。
- 展示落点：`views/settings/components/CloudAccountCard.vue` 的 `__sub` 副标题，已登录优先展示 backupSummary，否则回落「云账户」。

cloudBackup.js ↔ cloudAccount.js 有静态↔动态 import 环路（cloudBackup 运行时动态 import store 规避循环依赖），项目既有设计，构建仅出分包提示、非错误。
