---
name: project-generate-tab
description: 密码生成器（生成 Tab）的接入方式与还原要点，新增主导航 Tab 的范式
metadata:
  type: project
---

「生成」Tab（密码生成器，Figma node 1:831）已实现，是新增「主导航 Tab」的完整范例。

**接入一个新主导航 Tab 的步骤（4 处改动即可）：**
1. `stores/<tab>.js` 持状态 + mock（mock 集中文件末尾，真实接入只换 mock）。
2. `composables/use<Tab>.js` 编排 loading/ElMessage/AbortController 取消（照 useResetPassword 模式）。
3. `views/<tab>/<Tab>View.vue` 只承载可滚动内容（根容器 `height:100%; overflow-y:auto`，固定顶/底栏由 MainTabLayout 提供），私有子组件放同目录 `components/`。
4. 接通导航：`router/index.js` 在 MainTabLayout children 下加子路由（`meta.tab: '<key>'`）；`constants/tabs.js` 把对应项 `route: null` 改成路由名。Tab 顺序即滑动方向，无需动 useSwipeNav。

**MainTabLayout 顶栏搜索的串味陷阱**：原 keyword/headerText 用三元 `health ? health : vault`，新 Tab 会 fallback 写进 vaultStore。已改为显式 `health / vault / 其它→本地 ruler ref`，无搜索语义的 Tab（生成器）走 localKeyword 不污染业务 store。再加 Tab 时沿用此分支。

**Why**: 工程把「固定外壳 + 滑动内容」与「业务 store 持久化」严格分层，乱接会破坏滑动过渡或污染其它页搜索态。
**How to apply**: 四个主导航 Tab（库/健康/生成/设置）均已按此 4 步落地，可直接照搬。设置 Tab 详见 [[project-settings-tab]]。MainTabLayout 的搜索入口判断已从「!= generate」收敛为白名单 `SEARCHABLE_TABS = ['vault','health']`，新增无搜索语义的 Tab 无需再改 searchable。
