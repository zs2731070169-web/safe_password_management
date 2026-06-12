<script setup>
/**
 * 密码生成器内容组件（主导航「生成」Tab 内容主体）
 *
 * 由源工程 views/generate/GenerateView.vue 平移而来。顶栏 / 底栏由常驻 home 外壳
 * （pages/home/index.vue 的 swiper 外壳）统一提供，本组件只负责「长度滑块卡 +
 * 5 个字符集开关」主体内容，作为一个 swiper-item 常驻挂载。
 * 规则切换即时生效：拖动滑块 / 切换开关后由 useGenerator 自动静默持久化，无需手动保存按钮。
 *
 * 该 Tab 顶栏无搜索：home 顶栏对 generate 置 searchable=false，本组件不涉及 keyword。
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
  <view class="generate-content">
    <!-- 控制区：长度滑块 + 开关网格 -->
    <view class="generate-content__controls">
      <!-- 长度滑块卡（v-model 经 onLengthChange 转发到 store 夹紧） -->
      <LengthSlider
        :model-value="length"
        :min="minLength"
        :max="maxLength"
        @update:model-value="onLengthChange"
      />

      <!-- 字符集开关网格 -->
      <view class="generate-content__switches">
        <OptionSwitch
          v-for="item in SWITCHES"
          :key="item.key"
          :model-value="options[item.key]"
          :icon="item.icon"
          :label="item.label"
          @update:model-value="toggleOption(item.key)"
        />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.generate-content {
  display: flex;
  flex-direction: column;
  padding: $spacing-lg $layout-page-padding $spacing-2xl; // 上 24 / 左右 16 / 下 40
  background-color: $color-bg-page;

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
