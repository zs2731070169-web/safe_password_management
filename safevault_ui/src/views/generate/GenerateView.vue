<script setup>
/**
 * GenerateView —— 密码生成器页内容（主导航「生成」Tab）
 *
 * 仅承载中间可滚动内容；固定顶栏、底栏由常驻外壳 MainTabLayout 提供。
 * 像素级还原 Figma「密码生成器」(node 1:831) 的 Main 区：
 *   长度滑块卡（LengthSlider）+ 5 个字符集开关（OptionSwitch）。
 * 规则切换即时生效：拖动滑块 / 切换开关后由 useGenerator 自动静默持久化，无需手动保存按钮。
 * 业务状态与 mock 生成在 generator store；交互编排（自动保存 / 取消）在 useGenerator。
 */
import { onBeforeUnmount } from 'vue'

import LengthSlider from './components/LengthSlider.vue'
import OptionSwitch from './components/OptionSwitch.vue'

import { useGenerator } from '@/composables/useGenerator'

const { length, options, minLength, maxLength, setLength, toggleOption, cleanup } = useGenerator()

/**
 * 字符集开关配置（顺序即视觉自上而下，与设计稿一致）
 * key 对应 store.options 的键名；icon 为 AppIcon 注册名。
 */
const SWITCHES = [
  { key: 'uppercase', icon: 'case-upper', label: '包含大写 (A-Z)' },
  { key: 'lowercase', icon: 'case-lower', label: '包含小写 (a-z)' },
  { key: 'numbers', icon: 'numbers', label: '包含数字 (0-9)' },
  { key: 'symbols', icon: 'symbol', label: '包含符号 (!@#)' },
  { key: 'excludeAmbiguous', icon: 'eye-off', label: '排除易混淆 (i, l, 1, L, o, 0, O)' }
]

/** 长度滑块：经 setLength 走 store 夹紧逻辑并自动持久化 */
function onLengthChange(value) {
  setLength(value)
}

// 卸载时取消进行中的自动保存请求
onBeforeUnmount(cleanup)
</script>

<template>
  <main class="generate-content">
    <!-- 控制区：长度滑块 + 开关网格 -->
    <section class="generate-content__controls">
      <!-- 长度滑块卡（v-model 经 onLengthChange 转发到 store 夹紧） -->
      <LengthSlider
        :model-value="length"
        :min="minLength"
        :max="maxLength"
        @update:model-value="onLengthChange"
      />

      <!-- 字符集开关网格 -->
      <div class="generate-content__switches">
        <OptionSwitch
          v-for="item in SWITCHES"
          :key="item.key"
          :model-value="options[item.key]"
          :icon="item.icon"
          :label="item.label"
          @update:model-value="toggleOption(item.key)"
        />
      </div>
    </section>
  </main>
</template>

<style lang="scss" scoped>
.generate-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: $spacing-lg $layout-page-padding $spacing-2xl; // 上 24 / 左右 16 / 下 40
  background-color: $color-bg-page;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  // 控制区：滑块 + 开关网格
  &__controls {
    display: flex;
    flex-direction: column;
    gap: $spacing-lg; // 滑块卡与开关网格间距 24px
  }

  // 开关网格：每项 4px 间隙
  &__switches {
    display: flex;
    flex-direction: column;
    gap: $spacing-xxs; // 4px
  }
}
</style>
