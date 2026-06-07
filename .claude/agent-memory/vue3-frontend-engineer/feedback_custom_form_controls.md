---
name: feedback-custom-form-controls
description: 本工程开关/滑块用原生 input 自定义样式而非 Element Plus，避免 EP 样式覆盖成本
metadata:
  type: feedback
---

像素级还原表单控件（toggle 开关、range 滑块）时，用原生 `<input type="checkbox/range">` + 自定义 CSS，不引入 Element Plus 的 el-switch / el-slider。

**Why**: EP 控件默认样式与 Figma 差异大，覆盖成本高且需在 main.js 逐个补 CSS；原生 input 自带无障碍/键盘可达，配色尺寸完全可控。生成器页的 OptionSwitch（checkbox 隐藏承载语义 + ::after 手柄）、LengthSlider（range + `--percent` 渐变轨道双色）即此模式。
**How to apply**: 新做开关/滑块/单选等控件优先原生 input 自定义；仅 ElMessage/ElMessageBox/ElInput 等已引入的 EP 组件按需用。用到新 EP 组件才在 main.js 补对应 theme-chalk CSS。

**相关**: 手写 fill 图标核对手段 —— 无 puppeteer 时用 `qlmanage -t -s 160 -o /tmp x.svg` 把单个图标 SVG 渲染成 PNG 再 Read 目视（沙箱拦 localhost curl，dev server 截图不可用）。新拼的字形图标（如 numbers「123」、case-upper「A↑」）务必这样核对，避免描边 path 隐形或字形不可辨。
