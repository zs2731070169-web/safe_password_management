<script setup>
/**
 * SettingsView —— 设置页内容（主导航「设置」Tab）
 *
 * 仅承载中间可滚动内容；固定顶栏、底栏由常驻外壳 MainTabLayout 提供
 * （设置 Tab 顶栏不显示搜索，由外壳按 activeTab 控制）。
 * 顶部为云账户卡片，下接 安全 / 数据 / 显示 / 关于 四个分组，底部为退出登录。
 *
 * 业务状态与 mock 持久化在 settings / cloudAccount store；交互编排（开关反馈 / 自动锁定回填 /
 * 身份验证 / 退出登录）在 useSettings。自动锁定时长走行项就地展开的下拉框单选，点选即生效。
 */
import { ref } from 'vue'

import SettingGroup from './components/SettingGroup.vue'
import SettingItem from './components/SettingItem.vue'
import AboutCard from './components/AboutCard.vue'
import CloudAccountCard from './components/CloudAccountCard.vue'
import IdentityVerifyModal from '@/components/IdentityVerifyModal.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import AppIcon from '@/components/icons/AppIcon.vue'

import { useSettings } from '@/composables/useSettings'

const {
  biometric,
  maskAccount,
  cloudBackup,
  trashCount,
  autoLockOptions,
  autoLockLabel,
  cloudLoggedIn,
  cloudEmail,
  toggleSwitch,
  toggleBiometric,
  setAutoLock,
  placeholder,
  openChangePassword,
  openTrash,
  logout,
  verify,
  onIdentityVerified,
  onIdentityVisibleChange
} = useSettings()

/** 退出登录二次确认面板显隐 */
const logoutConfirm = ref(false)
</script>

<template>
  <main class="settings-content">
    <!-- 顶部：云账户卡片（已登录显示邮箱，未登录显示未登录） -->
    <CloudAccountCard :logged-in="cloudLoggedIn" :email="cloudEmail" />

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
        title="修改账户密码"
        @activate="openChangePassword"
      />
    </SettingGroup>

    <!-- 【数据】 -->
    <SettingGroup title="数据">
      <SettingItem
        type="toggle"
        icon="cloud"
        title="开启云备份"
        :model-value="cloudBackup"
        @update:model-value="toggleSwitch('cloudBackup')"
      />
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

    <!-- 底部：退出登录（软登出，回登录页） -->
    <button type="button" class="settings-content__logout" @click="logoutConfirm = true">
      <AppIcon name="login" :size="18" />
      <span>退出登录</span>
    </button>

    <!-- 敏感页前置身份验证（仅未开启指纹时出现，验证通过才跳转，避免目标页白屏） -->
    <IdentityVerifyModal
      :model-value="verify.visible"
      :allow-biometric="false"
      :title="verify.title"
      :hint="verify.hint"
      hint-icon="warning"
      confirm-text="验证并继续"
      @update:model-value="onIdentityVisibleChange"
      @verified="onIdentityVerified"
    />

    <!-- 退出登录二次确认 -->
    <ConfirmSheet
      v-model="logoutConfirm"
      title="退出登录"
      message="将退出当前云账户，需重新登录后才能访问保险库。"
      confirm-text="退出登录"
      tone="danger"
      @confirm="logout"
    />
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

  // 退出登录：纯文字按钮（无边框 / 无背景 / 无浮层，仅红字 + 轻微按压反馈）
  &__logout {
    @include button-reset;
    @include flex-center;
    gap: $spacing-xs; // 8px
    width: 100%;
    height: 52px;
    margin-top: $spacing-xs;
    color: $color-danger;
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    transition: opacity $transition-base;

    &:hover {
      opacity: 0.7;
    }

    &:active {
      opacity: 0.5;
    }
  }
}
</style>
