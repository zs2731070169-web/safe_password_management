import { h } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { useVaultStore } from '@/stores/vault'
import { copyText } from '@/services/clipboard'
import AppIcon from '@/components/icons/AppIcon.vue'

/**
 * useVault —— 密码库交互组合式函数
 *
 * 职责：编排筛选 / 搜索的转发，以及「复制密码 → 反馈」交互。
 * 视图层只关心调用与展示，不直接接触剪贴板与 store 取值逻辑。
 */
export function useVault() {
  const store = useVaultStore()
  const { filteredEntries, categories, activeCategory, keyword } = storeToRefs(store)

  /** 复制指定条目的明文密码到剪贴板，并给出反馈 */
  async function copySecret(entry) {
    const secret = store.getSecret(entry.id)
    if (!secret) {
      ElMessage.warning('暂无可复制的密码')
      return
    }
    try {
      await copyText(secret)
      // 友好提示：自带图标 + 主文案 + 安全副提醒
      // （自带图标而非依赖 ElMessage 内置图标，按需引入下后者不渲染；
      //   文本节点自动转义，无 XSS 风险）
      ElMessage({
        type: 'success',
        duration: 2500,
        grouping: true, // 连续复制合并，避免提示堆叠
        customClass: 'copy-toast-message',
        message: h('div', { class: 'copy-toast' }, [
          h(AppIcon, {
            name: 'shield-check',
            width: 16,
            height: 20,
            class: 'copy-toast__icon'
          }),
          h('div', { class: 'copy-toast__body' }, [
            h('div', { class: 'copy-toast__title' }, `已复制「${entry.name}」的密码`),
            h('div', { class: 'copy-toast__tip' }, '请尽快粘贴使用')
          ])
        ])
      })
    } catch {
      ElMessage.error('复制失败，请手动复制')
    }
  }

  return {
    // 响应式状态
    filteredEntries,
    categories,
    activeCategory,
    keyword,
    // 转发 action
    setCategory: store.setCategory,
    setKeyword: store.setKeyword,
    // 交互
    copySecret
  }
}
