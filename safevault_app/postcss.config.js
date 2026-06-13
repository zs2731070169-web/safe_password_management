/**
 * PostCSS 配置
 * - gap-fallback：为不支持 Flexbox gap 的旧浏览器（Chrome <84 / 部分 Android WebView）
 *   自动生成 margin 回退，解决组件间距丢失导致的布局错位。
 */
module.exports = {
  plugins: [
    require('./scripts/postcss-gap-fallback.cjs'),
  ],
}
