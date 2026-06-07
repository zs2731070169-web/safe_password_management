/**
 * 主导航 Tab 配置（单一数据源）
 *
 * 数组顺序即视觉从左到右的顺序，决定页面「滑动切换」的方向：
 *   目标 Tab 索引更大 → 新页从右滑入（前进，slide-left）
 *   目标 Tab 索引更小 → 新页从左滑入（后退，slide-right）
 * route 为对应路由名；尚未实现的 Tab 置 null（点击 / 滑动到此仅占位提示）。
 *
 * 底部导航条（AppTabBar）、滑动翻页（useSwipeNav）、路由过渡方向均以此为准。
 */
export const TABS = [
  { key: 'vault', label: '库', icon: 'tab-vault', route: 'Vault' },
  { key: 'health', label: '健康', icon: 'tab-health', route: 'Health' },
  { key: 'generate', label: '生成', icon: 'tab-generate', route: 'Generate' },
  { key: 'settings', label: '设置', icon: 'tab-settings', route: 'Settings' }
]

/**
 * 取 Tab 在导航中的索引
 * @param {string} key Tab key
 * @returns {number} 索引，不存在返回 -1
 */
export function tabIndexOf(key) {
  return TABS.findIndex((tab) => tab.key === key)
}
