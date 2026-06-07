<script setup>
/**
 * SettingsView —— 设置页内容（主导航「设置」Tab）
 *
 * 仅承载中间可滚动内容；固定顶栏、底栏由常驻外壳 MainTabLayout 提供
 * （设置 Tab 顶栏不显示搜索，由外壳按 activeTab 控制）。
 * 像素级还原 DRD 4.12：安全 / 数据 / 显示 / 关于 四个分组，开关型与跳转型混排，关键安全项置顶。
 *
 * 业务状态与 mock 持久化在 settings store；交互编排（开关反馈 / 自动锁定回填 / 占位提示）在 useSettings。
 * 本版本约定：
 *   - 深色模式：真正整屏换肤（useTheme 在 App.vue 挂载，切 html.theme-dark + 状态栏配色），切换即生效；
 *   - 自动锁定时长走行项就地展开的下拉框单选（SettingItem 自绘浮层），点选即生效；
 *   - 修改主密码 / 恢复码管理 / 加密导出导入 / 回收站等暂走占位提示。
 */
import SettingGroup from './components/SettingGroup.vue'
import SettingItem from './components/SettingItem.vue'
import AboutCard from './components/AboutCard.vue'

import { useSettings } from '@/composables/useSettings'

const {
  biometric,
  darkMode,
  maskAccount,
  trashCount,
  autoLockOptions,
  autoLockLabel,
  toggleSwitch,
  toggleBiometric,
  setAutoLock,
  placeholder,
  openChangePassword,
  openRecoveryCode,
  openTrash
} = useSettings()
</script>

<template>
  <main class="settings-content">
    <!-- 【安全】关键安全项置顶 -->
    <SettingGroup title="安全">
      <SettingItem
        type="toggle"
        icon="fingerprint"
        title="生物识别解锁"
        :model-value="biometric"
        @update:model-value="toggleBiometric"
      />
      <SettingItem
        type="select"
        icon="lock-clock"
        title="自动锁定"
        :value="autoLockLabel"
        :options="autoLockOptions"
        @select="setAutoLock"
      />
      <SettingItem
        icon="password"
        title="修改主密码"
        @activate="openChangePassword"
      />
      <SettingItem
        icon="refresh"
        title="恢复码管理"
        subtitle="重新生成恢复码"
        @activate="openRecoveryCode"
      />
    </SettingGroup>

    <!-- 【数据】 -->
    <SettingGroup title="数据">
      <SettingItem
        icon="backup"
        title="加密导出 / 导入备份"
        @activate="placeholder('加密导出 / 导入备份')"
      />
      <SettingItem
        icon="trash"
        title="回收站"
        :value="trashCount ? `${trashCount} 条` : ''"
        @activate="openTrash"
      />
    </SettingGroup>

    <!-- 【显示】 -->
    <SettingGroup title="显示">
      <SettingItem
        type="toggle"
        icon="dark-mode"
        title="深色模式"
        :model-value="darkMode"
        @update:model-value="toggleSwitch('darkMode')"
      />
      <SettingItem
        type="toggle"
        icon="eye-off"
        title="账号脱敏显示"
        :model-value="maskAccount"
        @update:model-value="toggleSwitch('maskAccount')"
      />
    </SettingGroup>

    <!-- 【关于】信任徽章 + 隐私 / 版本 -->
    <div class="settings-content__about">
      <h2 class="settings-content__about-title">关于</h2>
      <AboutCard version="v1.0" @activate="placeholder($event)" />
    </div>
  </main>
</template>

<style lang="scss" scoped>
.settings-content {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 分组间距 24px
  height: 100%;
  padding: $spacing-lg $layout-page-padding $spacing-2xl; // 上 24 / 左右 16 / 下 40
  background-color: $color-bg-page;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  // 关于区：与 SettingGroup 同构（标题 + 卡片）
  &__about {
    display: flex;
    flex-direction: column;
    gap: $spacing-xs;
  }

  &__about-title {
    padding-left: $spacing-xxs;
    font-size: $font-size-section; // 13px
    font-weight: $font-weight-bold;
    line-height: $line-height-section;
    letter-spacing: $letter-spacing-label;
    color: $color-text-muted;
  }
}
</style>
