---
name: reference-design-assets
description: SafeVault 设计资产位置：DESIGN.md 设计 Token，13 个原型 code.html，以及哪些 screen.png 损坏
metadata:
  type: reference
---

设计资产（唯一真实来源）位于项目根 `UI/` 下：

- 设计 Token / 规范：`UI/app_ui/sentinel_core/DESIGN.md`（colors/typography/spacing/borderRadius + 品牌/配色/字体/布局/阴影/形状/组件规范）。
- 13 屏原型：`UI/app_ui/_1` ~ `_13`，每个目录含 `code.html`（Tailwind 实现，改造源依据）。

坑：
- `_2/_6/_7/_8/_10/_13` 的 screen.png 是损坏的 HTML 错误页（非图片），直接读 code.html。
- `_1/_3/_4/_5/_9/_11/_12` 的 screen.png 是有效截图。
- `_11` 只有 screen.png 无 code.html，且其截图实际等于 _9 的"新增密码"表单。
- `_4/screen.png` 显示的是健康仪表盘(=_3)，与 _4/code.html(生成器) 不一致，以 code.html 为准。
