---
name: project-settings-tab
description: 设置 Tab（DRD 4.12）的接入方式、ElMessageBox 单选弹窗范式、深色/大字体仅记录状态的 TODO
metadata:
  type: project
---

「设置」Tab（DRD 4.12，第 4 个主导航 Tab）已按 [[project-generate-tab]] 的 4 步范式落地。
分层：`stores/settings.js`（持状态 + localStorage 持久化 mock）/ `composables/useSettings.js`（交互编排）/ `views/settings/SettingsView.vue` + 私有子组件 `SettingGroup`（分组卡壳）`SettingItem`（toggle/select/navigate 三态行）`AboutCard`（关于信任徽章 + 隐私/开源/版本）。

**本版本刻意保留的 mock / TODO（真实接入时要动的地方）：**
- 深色模式 / 大字体两开关「仅记录状态并持久化」，**不真正换肤/改字号**。切换后只给 ElMessage.info 占位提示（useSettings 的 TODO_HINT）。真实接入：监听 darkMode/largeText 写 html class 或 CSS 变量。
- 自动锁定时长选项 `AUTO_LOCK_OPTIONS`（0/30/60/120/300 秒）在 settings store 导出；回收站数量 `trashCount` 写死 mock=3（`mockTrashCount`）。
- 修改主密码 / 恢复码管理 / 安全问题管理 / 加密导出导入 / 回收站点击 = 统一 `placeholder(label)` → ElMessage.info 占位，均未接真实页面。
- 偏好持久化 key = `safevault.settings`（localStorage），store 内 `watch` 全量偏好写回；真实接入只换 `persistPrefs`/`loadPrefs` 两个 mock 函数。

**ElMessageBox 自定义单选弹窗范式（自动锁定时长选择，可复用于其它「点选即生效」场景）：**
用 `ElMessageBox({ showConfirmButton:false, message: () => h('ul', ...选项) })`，每个 `<li>` 的 onClick 里**先写 store 再 `ElMessageBox.close()`**——不要依赖弹窗 promise 的 resolve/reject 回填，因为 `close()` 默认以 cancel **reject**，then 分支拿不到值。外层 `.catch(()=>{})` 静默吞掉取消。弹窗列表样式（`.auto-lock-box`/`.auto-lock-list`）因渲染在 body overlay 下，**必须写在全局 `styles/index.scss`**，scoped 不生效（与既有 `.copy-toast-message` 同理）。

**Why**: 这些 TODO 是产品节奏选择（先铺页面骨架），不是遗漏；ElMessageBox 的 close-reject 行为是踩过的坑。
**How to apply**: 后续做深色换肤/真实回收站/导出页时从上述 mock 点切入，视图与 composable 尽量不动。需要「弹窗内单选」时照搬上面的 close()+catch 范式与全局样式约定。
