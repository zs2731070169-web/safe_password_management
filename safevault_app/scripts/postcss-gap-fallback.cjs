/**
 * PostCSS 插件：为 flex gap 添加 margin 回退
 *
 * 问题：Chrome 84 以下、部分 Android WebView 不支持 Flexbox gap，
 *       导致依赖 gap 做组件间距的布局「紧贴在一起」。
 * 方案：在每个含 gap 的规则后，生成 @supports not (gap:1px) 回退块，
 *       用 > * + * { margin-top / margin-left } 模拟 gap。
 *
 * 判定 flex 方向：
 *   - 同规则内显式写了 flex-direction: column / column-reverse → row-gap 用 margin-top
 *   - 同规则内显式写了 flex-direction: row / row-reverse     → column-gap 用 margin-left
 *   - 未声明 flex-direction（默认 row）                        → column-gap 用 margin-left
 *   - 既有 row-gap 又有 column-gap 且方向为 column            → 分别加 margin-top + margin-left
 *
 * 产出格式：
 *   @supports not (gap: 1px) {
 *     .selector > * + * { margin-top: 16px; }
 *   }
 */
const postcss = require('postcss')

module.exports = (opts = {}) => {
  return {
    postcssPlugin: 'postcss-gap-fallback',
    Once(root) {
      // 收集所有需要添加的回退规则，最后统一追加到 root 末尾
      const fallbacks = []

      root.walkRules((rule) => {
        let gapDecl = null
        let rowGapDecl = null
        let columnGapDecl = null
        let flexDirection = null // null = 未声明（默认 row）

        rule.walkDecls((decl) => {
          if (decl.prop === 'gap') gapDecl = decl
          if (decl.prop === 'row-gap') rowGapDecl = decl
          if (decl.prop === 'column-gap') columnGapDecl = decl
          if (decl.prop === 'flex-direction') flexDirection = decl.value
        })

        // 如果没有任何 gap 声明，跳过
        if (!gapDecl && !rowGapDecl && !columnGapDecl) return

        const isColumn =
          flexDirection === 'column' || flexDirection === 'column-reverse'

        // —— 解析 gap 值 ——
        let rowGapValue = null
        let columnGapValue = null

        if (gapDecl) {
          const parts = postcss.list.space(gapDecl.value)
          if (parts.length === 1) {
            rowGapValue = parts[0]
            columnGapValue = parts[0]
          } else if (parts.length === 2) {
            rowGapValue = parts[0]
            columnGapValue = parts[1]
          }
        }
        // row-gap / column-gap 单独声明优先于 gap 简写
        if (rowGapDecl) rowGapValue = rowGapDecl.value
        if (columnGapDecl) columnGapValue = columnGapDecl.value

        // —— 生成 margin 回退 ——
        // 策略：只为主轴方向添加 margin，避免交叉轴多余间距。
        // 单值 gap 时：column → margin-top，row → margin-left
        // 双值 gap 时：两轴各加对应 margin
        const isSingleValueGap = gapDecl && postcss.list.space(gapDecl.value).length === 1
        const marginProps = []

        if (isColumn) {
          // column 方向：主轴纵向 → row-gap 用 margin-top
          if (rowGapValue && rowGapValue !== '0' && rowGapValue !== '0px') {
            marginProps.push({ prop: 'margin-top', value: rowGapValue })
          }
          // 交叉轴（横向间距）仅双值 gap 时补充
          if (
            !isSingleValueGap &&
            columnGapValue &&
            columnGapValue !== '0' &&
            columnGapValue !== '0px'
          ) {
            marginProps.push({ prop: 'margin-left', value: columnGapValue })
          }
        } else {
          // row 方向（默认）：主轴横向 → column-gap 用 margin-left
          if (
            columnGapValue &&
            columnGapValue !== '0' &&
            columnGapValue !== '0px'
          ) {
            marginProps.push({ prop: 'margin-left', value: columnGapValue })
          }
          // 交叉轴（纵向间距）仅双值 gap 时补充
          if (
            !isSingleValueGap &&
            rowGapValue &&
            rowGapValue !== '0' &&
            rowGapValue !== '0px'
          ) {
            marginProps.push({ prop: 'margin-top', value: rowGapValue })
          }
        }

        if (marginProps.length === 0) return

        // 创建回退规则：.selector > * + * { margin-xxx: value; }
        const fallbackRule = postcss.rule({
          selector: `${rule.selector} > * + *`,
        })
        for (const { prop, value } of marginProps) {
          fallbackRule.append(postcss.decl({ prop, value }))
        }

        fallbacks.push(fallbackRule)
      })

      // 统一包裹在 @supports not (gap: 1px) 内追加到末尾
      if (fallbacks.length > 0) {
        const supportsAtRule = postcss.atRule({
          name: 'supports',
          params: 'not (gap: 1px)',
        })
        for (const rule of fallbacks) {
          supportsAtRule.append(rule)
        }
        root.append(supportsAtRule)
      }
    },
  }
}

module.exports.postcss = true
