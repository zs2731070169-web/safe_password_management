<script setup>
/**
 * 主导航单页外壳（home）—— 库 / 健康 / 生成 / 设置四 Tab 的常驻容器
 *
 * 【为何合并为单页】源工程用「常驻外壳 + 内层 router-view」承载四 Tab，仅内层横向滑动过渡。
 * 早期 uni 迁移把每个 Tab 做成独立 page、切换走 reLaunch，导致：① 无横滑过渡；
 * ② reLaunch 销毁并重建目标页，重建瞬间闪出空白（「切换割裂」）。「独立页 + reLaunch」
 * 架构下无缝滑动根本做不到。
 *
 * 【方案】保留自绘底栏（不用 uni 原生 tabBar），改为单页 + 原生 <swiper>：四个 swiper-item
 * 常驻挂载、不重建，由 swiper 提供真正无缝的横向滑动切换，并原生承接横滑手势（取代旧的
 * 手写 useSwipeNav）。顶栏 AppHeader 跨 Tab 常驻，按当前 Tab 切换搜索配置与关键词绑定。
 *
 * 【keyword 绑定】顶栏关键词仍由各自 store 持有（Pinia 跨页持久）。本页直接读写
 * vault / health store 的 keyword（而非调 useVault / useHealth composable），避免重复触发
 * 这些 composable 的 onMounted 副作用（如 vault 的 loadBackupMeta）——副作用归各内容组件。
 *
 * 【导航】Tab 间切换只移动 swiper 的 current（带平滑动画），不再做页面跳转；FAB / 子页跳转
 * 经 navTo。外部入口 / 子页跳某 Tab 走 navTo('Vault') 等 → navigation 转 reLaunch 到
 * /pages/home/index?tab=key，本页 onLoad 读 tab 决定初始 Tab。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

import AppHeader from '@/components/AppHeader.vue'
import AppTabBar from '@/components/AppTabBar.vue'
import AddFab from '@/components/AddFab.vue'

import VaultTab from '@/pages/vault/VaultTab.vue'
import HealthTab from '@/pages/health/HealthTab.vue'
import GenerateTab from '@/pages/generate/GenerateTab.vue'
import SettingsTab from '@/pages/settings/SettingsTab.vue'

import { TABS, tabIndexOf } from '@/constants/tabs'
import { useVaultStore } from '@/stores/vault'
import { useHealthStore } from '@/stores/health'
import { navTo } from '@/utils/navigation'

// —— 当前激活 Tab：用 swiper 索引作单一真值，key 由索引派生 ——
const activeIndex = ref(0)
const activeKey = computed(() => TABS[activeIndex.value]?.key ?? 'vault')

// onLoad 读 ?tab=key 决定初始 Tab（深链 / 外部跳转落地）；缺省 / 非法回退到首个 Tab（库）
onLoad((query) => {
  const idx = tabIndexOf(query?.tab)
  if (idx >= 0) activeIndex.value = idx
})

/**
 * 顶栏按 Tab 的搜索配置：仅库 / 健康有搜索语义。
 * 生成 / 设置无搜索 → searchable=false，顶栏只显示品牌。
 */
const HEADER_CONFIG = {
  vault: { searchable: true, placeholder: '搜索平台 / 账号', searchLabel: '搜索密码' },
  health: { searchable: true, placeholder: '搜索问题项', searchLabel: '搜索健康问题' },
  generate: { searchable: false, placeholder: '搜索', searchLabel: '搜索' },
  settings: { searchable: false, placeholder: '搜索', searchLabel: '搜索' }
}
const headerConfig = computed(() => HEADER_CONFIG[activeKey.value] ?? HEADER_CONFIG.vault)

// —— 顶栏关键词：代理到当前 Tab 的 store（vault / health），其余 Tab 无搜索（空串 / no-op）——
const vaultStore = useVaultStore()
const healthStore = useHealthStore()
const keyword = computed({
  get() {
    if (activeKey.value === 'vault') return vaultStore.keyword
    if (activeKey.value === 'health') return healthStore.keyword
    return ''
  },
  set(value) {
    if (activeKey.value === 'vault') vaultStore.setKeyword(value)
    else if (activeKey.value === 'health') healthStore.setKeyword(value)
    // generate / settings 无搜索：忽略
  }
})

/** swiper 滑动结束：同步激活索引（横滑手势 / 点击底栏触发的动画都会经此回流） */
function onSwiperChange(e) {
  activeIndex.value = e.detail.current
}

/** 底栏点击切 Tab：设激活索引，swiper 经 :current 绑定平滑滑过去（不做页面跳转） */
function onTabChange(key) {
  const idx = tabIndexOf(key)
  if (idx >= 0) activeIndex.value = idx
}

/** 新增密码：库页 FAB → 跳新增页（子页，自右滑入） */
function handleAdd() {
  navTo('AddPassword')
}
</script>

<template>
  <view class="home">
    <!-- 固定顶栏（跨 Tab 常驻，配置随当前 Tab 切换） -->
    <AppHeader
      v-model="keyword"
      :placeholder="headerConfig.placeholder"
      :search-label="headerConfig.searchLabel"
      :searchable="headerConfig.searchable"
      class="home__header"
    />

    <!-- 中间内容：原生 swiper 承载四 Tab，常驻挂载、横滑无缝切换 -->
    <swiper
      class="home__swiper"
      :current="activeIndex"
      :duration="280"
      @change="onSwiperChange"
    >
      <!-- 每个 swiper-item 内用 scroll-view 承接纵向滚动（横滑归 swiper） -->
      <swiper-item class="home__item">
        <scroll-view scroll-y class="home__scroll">
          <VaultTab />
        </scroll-view>
      </swiper-item>

      <swiper-item class="home__item">
        <scroll-view scroll-y class="home__scroll">
          <HealthTab />
        </scroll-view>
      </swiper-item>

      <swiper-item class="home__item">
        <scroll-view scroll-y class="home__scroll">
          <GenerateTab />
        </scroll-view>
      </swiper-item>

      <swiper-item class="home__item">
        <scroll-view scroll-y class="home__scroll">
          <SettingsTab />
        </scroll-view>
      </swiper-item>
    </swiper>

    <!-- 悬浮新增按钮：仅库 Tab 显示 -->
    <AddFab v-if="activeKey === 'vault'" class="home__fab" @click="handleAdd" />

    <!-- 固定底栏：仅切换高亮项，点击移动 swiper -->
    <AppTabBar
      class="home__tabbar"
      :active="activeKey"
      @change="onTabChange"
    />
  </view>
</template>

<style lang="scss" scoped>
.home {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: $color-bg-page;
  overflow: hidden;

  &__header {
    flex-shrink: 0;
  }

  // swiper 必须给确定高度（uni swiper 默认 150px、flex:1 在 app-vue 不可靠）：
  // = 100vh − 顶栏高（$layout-tabbar-height + 安全区上）− 底栏高（$layout-tabbar-height + 6px + 安全区下）
  // 与 AppHeader / AppTabBar 各自的 height 算式严格对齐。
  &__swiper {
    flex: 1;
    height: calc(
      100vh
      - #{$layout-tabbar-height} - #{$safe-area-top}
      - #{$layout-tabbar-height + 6px} - env(safe-area-inset-bottom)
    );
  }

  &__item {
    height: 100%;
  }

  // 单个 Tab 的纵向滚动容器
  &__scroll {
    height: 100%;
  }

  // 悬浮新增按钮：浮于底部导航之上、贴右
  &__fab {
    position: absolute;
    right: $spacing-lg; // 24px
    bottom: calc(#{$layout-tabbar-height + 6px + $spacing-lg} + env(safe-area-inset-bottom));
    z-index: $z-content + 1;
  }

  &__tabbar {
    flex-shrink: 0;
  }
}
</style>
