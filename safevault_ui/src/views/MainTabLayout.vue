<script setup>
/**
 * MainTabLayout —— 主导航常驻外壳
 *
 * 承载所有主导航 Tab 页（库 / 健康）共享的「固定顶栏 + 中间滑动内容 + 固定底栏」骨架，
 * 库页专属的悬浮新增按钮 FAB 也置于此。Tab 间切换时本外壳组件复用不重建，
 * 故顶栏、底栏保持不动（仅底栏高亮项与顶栏占位文案随当前 Tab 变化），
 * 只有中间内层 <router-view> 的内容做横向滑动过渡（见底部非 scoped 样式）。
 *
 * 顶栏搜索关键词按当前 Tab 路由到各自 store（库 / 健康），互不串味。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import AppHeader from '@/components/AppHeader.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import AddFab from '@/views/vault/components/AddFab.vue'

import { routeTransition } from '@/router/transition'
import { TABS } from '@/constants/tabs'
import { useSwipeNav } from '@/composables/useSwipeNav'
import { useVaultStore } from '@/stores/vault'
import { useHealthStore } from '@/stores/health'

const route = useRoute()
const router = useRouter()

const vaultStore = useVaultStore()
const healthStore = useHealthStore()

/** 当前激活的 Tab key（取自子路由 meta.tab） */
const activeTab = computed(() => route.meta.tab ?? 'vault')

/** 具备搜索语义的 Tab（仅库 / 健康按名称 / 问题项搜索）；其余 Tab 顶栏不显示搜索入口 */
const SEARCHABLE_TABS = ['vault', 'health']

/** 当前 Tab 是否可搜索（生成规则 / 设置等无搜索语义，隐藏右上角搜索入口） */
const searchable = computed(() => SEARCHABLE_TABS.includes(activeTab.value))

// 无搜索语义的 Tab（如生成器 / 设置）顶栏搜索仅作占位，写入本地 ref 不污染业务 store
const localKeyword = ref('')

/** 顶栏搜索关键词：按当前 Tab 读写对应 store，保持各页搜索状态独立 */
const keyword = computed({
  get: () => {
    if (activeTab.value === 'health') return healthStore.keyword
    if (activeTab.value === 'vault') return vaultStore.keyword
    return localKeyword.value
  },
  set: (value) => {
    if (activeTab.value === 'health') healthStore.keyword = value
    else if (activeTab.value === 'vault') vaultStore.keyword = value
    else localKeyword.value = value
  }
})

/** 顶栏占位 / 无障碍文案：各 Tab 搜索语义不同 */
const headerText = computed(() => {
  if (activeTab.value === 'health')
    return { placeholder: '搜索问题项名称', searchLabel: '搜索问题项' }
  if (activeTab.value === 'vault')
    return { placeholder: '搜索名称或账号', searchLabel: '搜索密码' }
  return { placeholder: '搜索', searchLabel: '搜索' }
})

/**
 * 切换底部 Tab：已实现的 Tab 走路由跳转，未实现的占位提示。
 * 路由名取自 constants/tabs 的单一数据源（TABS[].route）。
 */
function onTabChange(key) {
  if (key === activeTab.value) return
  const target = TABS.find((tab) => tab.key === key)
  if (target?.route) {
    router.push({ name: target.route })
  } else {
    ElMessage.info('该功能正在开发中')
  }
}

/** 新增密码：从库页 FAB 进入新增页 */
function handleAdd() {
  router.push({ name: 'AddPassword' })
}

// 触摸滑动翻页：与底部导航点击互补。外壳常驻，activeTab 随路由变，故传响应式 ref。
const { onTouchStart, onTouchEnd } = useSwipeNav(activeTab, onTabChange)
</script>

<template>
  <div class="tab-layout">
    <!-- 固定顶栏（品牌 + 可展开搜索，跨 Tab 常驻） -->
    <AppHeader
      v-model="keyword"
      :placeholder="headerText.placeholder"
      :search-label="headerText.searchLabel"
      :searchable="searchable"
      class="tab-layout__header"
    />

    <!-- 中间内容区：仅此处随 Tab 横向滑动 -->
    <main
      class="tab-layout__body"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
      <router-view v-slot="{ Component }">
        <transition :name="routeTransition.name">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- 悬浮新增按钮（仅库页） -->
    <AddFab v-if="activeTab === 'vault'" class="tab-layout__fab" @click="handleAdd" />

    <!-- 固定底栏：仅切换高亮项 -->
    <AppTabBar
      class="tab-layout__tabbar"
      :active="activeTab"
      @change="onTabChange"
    />
  </div>
</template>

<style lang="scss" scoped>
.tab-layout {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh; // 移动端更稳的视口高度
  background-color: $color-bg-page;
  overflow: hidden;

  &__header {
    flex-shrink: 0;
  }

  // 中间内容容器：内层页面在此相对叠放并裁剪，实现「只有内容滑动」
  &__body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  // 悬浮新增按钮：浮于底部导航之上、贴右（沿用原库页定位）
  &__fab {
    position: absolute;
    right: $spacing-lg; // 24px
    // 导航高度 70 + 24 间距 + 底部安全区
    bottom: calc(#{$layout-tabbar-height + 6px + $spacing-lg} + env(safe-area-inset-bottom));
    z-index: $z-content + 1;
  }

  &__tabbar {
    flex-shrink: 0;
  }
}
</style>

<!--
  内层 Tab 内容的横向滑动过渡须为「全局」：过渡 class 加在子视图根节点上，
  写在 scoped 内会被页面根（如 .vault-content{position:relative}）以更高优先级盖掉，
  导致滑动时两页未绝对叠放、露出底色形成留白。故置于非 scoped 块，并对定位用
  !important 压过页面根；两页均相对 .tab-layout__body（relative + overflow:hidden）叠放裁剪。
-->
<style lang="scss">
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  position: absolute !important;
  inset: 0;
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
// 前进（slide-left）：新页自右侧滑入，旧页向左侧滑出
.slide-left-enter-from {
  transform: translateX(100%);
}
.slide-left-leave-to {
  transform: translateX(-100%);
}
// 后退（slide-right）：新页自左侧滑入，旧页向右侧滑出
.slide-right-enter-from {
  transform: translateX(-100%);
}
.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
