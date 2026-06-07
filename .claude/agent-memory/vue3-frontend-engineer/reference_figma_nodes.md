---
name: reference-figma-nodes
description: SafeVault Figma 文件（fileKey bbk8PtnXCI2tsbFc7RzGMH）各界面节点 id 映射，含重名/副本陷阱
metadata:
  type: reference
---

Figma 设计文件 fileKey：`bbk8PtnXCI2tsbFc7RzGMH`，全部画板在 Page `0:1`。

**坑：整套画板存在多份坐标偏移的副本，节点名大量重复。** 同一界面会出现 2~3 个 id（如 `1:299` / `1:1400` 都叫「启动/解锁页-锁定态」）。按 id 定位时务必先用 get_metadata 核对界面内容，不要只信节点名。`get_metadata(0:1)` 输出超大（27 万字符），会被存盘截断，需用 python 解析 JSON 后按 width≈390 过滤顶层画板。

界面 → 节点 id（取主副本）：
- 启动/解锁页（生物识别为主，指纹大圆按钮）：`1:922`
- 启动/解锁页-带主密码输入态（**即「主密码解锁界面」**）：`1:525`（副本 `1:1626`）
- 启动/解锁页-锁定态：`1:299`（副本 `1:1400`）
- 密码库主页：`1:962`（副本 `1:2063`）
- 密码详情页-带删除验证：`1:348`（副本 `1:1449`）
- 密码健康度中心-优化版：`1:659`（副本 `1:1760`）
- 找回访问权限-重设主密码：`1:583`（副本 `1:1684`）
- 找回访问权限-输入恢复码：`1:759`（副本 `1:1860`）

**重要提醒**：任务里给的节点号可能与界面名不符。本次任务声称「主密码解锁界面 = 1:922」，但 1:922 实为生物识别启动页；真正的主密码输入界面是 1:525。遇到对不上时以界面内容/设计意图为准。

工程映射：`1:922` → [[reference-design-assets]] 之外的 `src/views/unlock/UnlockView.vue`；`1:525` → `src/views/unlock/MasterPasswordView.vue`（路由 `/unlock/master`，name `MasterPassword`）。
