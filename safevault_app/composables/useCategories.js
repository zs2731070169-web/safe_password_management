/**
 * useCategories —— 分类管理交互编排
 *
 * 转发分类的增删改排到 vault store，并在此层做「重名 / 空名」校验与 ElMessage 反馈，
 * 让视图只管渲染与触发，不直接接触 store 的边界判断。
 *
 * 设计口径：
 *   - 内置「全部」(key='all') 是筛选项而非真实分类，对外暴露的 manageableCategories 已排除它，
 *     视图据此渲染可管理列表；首尾位置据此判断上/下移是否可用。
 *   - 删除分类不删条目：归属条目一律落为「未分类」，反馈里告知影响条目数（由视图在确认面板提示）。
 *
 * 视图只调用本组合式函数（与 useTrash / useSettings 等保持一致）。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { toastSuccess, toastError, toastInfo } from '@/utils/feedback'

import { useVaultStore } from '@/stores/vault'

export function useCategories() {
  const store = useVaultStore()
  const { categories, entryCountByCategory } = storeToRefs(store)

  /**
   * 可管理分类列表（排除内置「全部」），每项附带当前条目数 count 供展示。
   * 顺序与 store.categories 一致，首项 isFirst / 末项 isLast 供视图禁用上/下移按钮。
   */
  const manageableCategories = computed(() => {
    const list = categories.value.filter((c) => c.key !== 'all')
    return list.map((c, i) => ({
      ...c,
      count: entryCountByCategory.value[c.key] ?? 0,
      isFirst: i === 0,
      isLast: i === list.length - 1
    }))
  })

  /** 未分类（category 为空）的条目数，用于提示「删除后落入未分类」的累计规模 */
  const uncategorizedCount = computed(() => entryCountByCategory.value[''] ?? 0)

  /**
   * 新建分类。空名忽略；重名（忽略大小写与首尾空格）则提示已存在、不重复添加。
   * @param {string} label 分类显示名
   * @returns {boolean} 是否新建了一个分类
   */
  function add(label) {
    const text = (label ?? '').trim()
    if (!text) {
      toastInfo('请输入分类名称')
      return false
    }
    const before = categories.value.length
    store.addCategory(text)
    if (categories.value.length === before) {
      toastInfo(`分类「${text}」已存在`)
      return false
    }
    toastSuccess(`已新建分类「${text}」`)
    return true
  }

  /**
   * 重命名分类。空名 / 与其它分类重名时拒绝并提示；与自身原名相同则静默忽略。
   * @param {string} key 分类 key
   * @param {string} label 新显示名
   * @returns {boolean} 是否实际改名
   */
  function rename(key, label) {
    const text = (label ?? '').trim()
    if (!text) {
      toastInfo('分类名称不能为空')
      return false
    }
    const lower = text.toLowerCase()
    const duplicated = categories.value.some(
      (c) => c.key !== key && c.label.toLowerCase() === lower
    )
    if (duplicated) {
      toastInfo(`已存在分类「${text}」`)
      return false
    }
    return store.renameCategory(key, text)
  }

  /**
   * 删除分类（归属条目落为未分类）。二次确认由视图的 ConfirmSheet 负责，此处只执行 + 反馈。
   * @param {{ key: string, label: string }} category 分类
   */
  function remove(category) {
    if (store.removeCategory(category.key)) {
      toastSuccess(`已删除分类「${category.label}」`)
    }
  }

  /**
   * 上移 / 下移分类一位。
   * @param {string} key 分类 key
   * @param {'up'|'down'} direction 方向
   */
  function move(key, direction) {
    store.moveCategory(key, direction)
  }

  return {
    // 状态
    manageableCategories,
    uncategorizedCount,
    // 方法
    add,
    rename,
    remove,
    move
  }
}
