/**
 * usePasswordDetail —— 密码详情页交互编排
 *
 * 封装：密码明文显隐 + 自动隐藏倒计时、账号/密码复制反馈。
 * 复制统一走 services/clipboard（真机系统剪贴板 / 浏览器降级），兼容手机端。
 */
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { copyText as writeClipboard } from '@/services/clipboard'

/** 明文展示自动隐藏时长（秒） */
const REVEAL_SECONDS = 20

/**
 * @param {import('vue').Ref<object|null>} entry 当前条目响应式引用
 */
export function usePasswordDetail(entry) {
  /** 是否明文显示密码 */
  const revealed = ref(false)
  /** 自动隐藏剩余秒数 */
  const remaining = ref(0)
  let timer = null

  /** 切换密码显隐 */
  function toggleReveal() {
    revealed.value ? hidePassword() : revealPassword()
  }

  /** 显示明文并启动倒计时 */
  function revealPassword() {
    revealed.value = true
    remaining.value = REVEAL_SECONDS
    stopTimer()
    timer = setInterval(() => {
      remaining.value -= 1
      if (remaining.value <= 0) hidePassword()
    }, 1000)
  }

  /** 隐藏明文 */
  function hidePassword() {
    revealed.value = false
    remaining.value = 0
    stopTimer()
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** 复制文本并反馈 */
  async function copyText(text, successMsg) {
    if (!text) {
      ElMessage.warning('暂无可复制的内容')
      return
    }
    try {
      await writeClipboard(text)
      ElMessage.success(successMsg)
    } catch {
      ElMessage.error('复制失败，请手动复制')
    }
  }

  /** 复制账号 */
  function copyAccount() {
    copyText(entry.value?.account, '已复制账号')
  }

  /** 复制密码 */
  function copyPassword() {
    copyText(entry.value?.password, '已复制密码')
  }

  // 离开时清理定时器
  onUnmounted(stopTimer)

  return {
    revealed,
    remaining,
    revealSeconds: REVEAL_SECONDS,
    toggleReveal,
    copyAccount,
    copyPassword
  }
}
