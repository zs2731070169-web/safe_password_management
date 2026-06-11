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
  pendingRecovery,
  toggleSwitch,
  toggleBiometric,
  setAutoLock,
  placeholder,
  openChangePassword,
  openRegenerateRecovery,
  openRecoverData,
  openTrash,
  openCategories,
  openPrivacy,
  restoreFromCloud,
  requestDeleteBackup,
  logout,
  verify,
  onIdentityVerified,
  onIdentityVisibleChange
} = useSettings()

/** 退出登录二次确认面板显隐 */
const logoutConfirm = ref(false)
/** 从云端恢复二次确认面板显隐 */
const restoreConfirm = ref(false)

/** 关于卡片行点击分发：隐私政策跳转独立页，其余暂为占位提示 */
function onAboutActivate(label) {
  if (label === '隐私政策') openPrivacy()
  else placeholder(label)
}
</script>

<template>
  <main class="settings-content">
    <!-- 顶部：云账户卡片（已登录显示邮箱，未登录显示未登录） -->
    <CloudAccountCard
      :logged-in="cloudLoggedIn"
      :email="cloudEmail"
    />

    <!-- 数据待恢复横幅：重置密码后跳过了恢复，云备份/同步会静默失效；点此输入恢复码或重建 -->
    <button
      v-if="pendingRecovery"
      type="button"
      class="recover-banner"
      @click="openRecoverData"
    >
      <span class="recover-banner__icon" aria-hidden="true">
        <AppIcon name="warning" :width="18" :height="18" />
      </span>
      <span class="recover-banner__body">
        <span class="recover-banner__title">数据待恢复</span>
        <span class="recover-banner__desc">重置密码后尚未恢复，云备份与同步暂不可用。点此处理</span>
      </span>
      <AppIcon name="arrow-right" :size="16" class="recover-banner__arrow" />
    </button>

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
      <!-- 恢复码：重新生成后旧码失效，是忘记密码后恢复数据的唯一凭据 -->
      <SettingItem
        icon="account-key"
        title="恢复码"
        value="重新生成"
        @activate="openRegenerateRecovery"
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
      <!-- 从云端恢复备份：点击先弹底部确认面板，确认后用云端快照覆盖本地库 -->
      <SettingItem
        icon="recovery-key"
        title="从云端同步备份"
        @activate="restoreConfirm = true"
      />
      <SettingItem
        icon="shapes"
        title="分类管理"
        @activate="openCategories"
      />
      <SettingItem
        icon="trash"
        title="回收站"
        :value="trashCount ? `${trashCount} 条` : ''"
        @activate="openTrash"
      />
      <!-- 删除云端备份（模块 2 DELETE /backup，方案 A）：危险操作，红色样式；
           点击先弹身份验证窗口（指纹 / 主密码，同「修改密码」），验证通过才销毁云端 blob。
           与「开启云备份」开关解耦——关开关只本地停传，唯有此处显式删除才删云端数据。 -->
      <SettingItem
        icon="trash"
        title="删除云端备份"
        danger
        @activate="requestDeleteBackup"
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
      <AboutCard version="v1.0" @activate="onAboutActivate" />
    </div>

    <!-- 底部：退出登录（软登出，回登录页） -->
    <button type="button" class="settings-content__logout" @click="logoutConfirm = true">
      <AppIcon name="login" :size="18" />
      <span>退出登录</span>
    </button>

    <!-- 敏感操作前置身份验证（仅未开启指纹时出现）：修改密码 / 重新生成恢复码验证通过后跳转，
         删除云端备份验证通过后执行删除。确认文案与色调随场景定制（删除用红色「验证并删除」）。 -->
    <IdentityVerifyModal
      :model-value="verify.visible"
      :allow-biometric="false"
      :title="verify.title"
      :hint="verify.hint"
      hint-icon="warning"
      :confirm-text="verify.confirmText"
      :tone="verify.tone"
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

    <!-- 从云端同步二次确认 -->
    <ConfirmSheet
      v-model="restoreConfirm"
      title="从云端同步备份"
      confirm-text="同步"
      tone="confirm"
      @confirm="restoreFromCloud"
    />
  </main>
</template>

<style lang="scss" scoped>
// 数据待恢复横幅：醒目警示底，整行可点进入恢复 / 重建
.recover-banner {
  @include button-reset;
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  width: 100%;
  padding: $spacing-sm;
  background-color: $color-warning-soft;
  border: 1px solid rgba($color-warning, 0.3);
  border-radius: $radius-lg;
  text-align: left;
  transition:
    filter $transition-base,
    transform $transition-fast;

  &:hover {
    filter: brightness(0.98);
  }

  &:active {
    transform: scale(0.995);
  }

  &:focus-visible {
    outline: 2px solid rgba($color-warning, 0.4);
    outline-offset: 2px;
  }

  &__icon {
    @include flex-center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: $radius-pill;
    background-color: rgba($color-warning, 0.16);
    color: $color-warning;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  &__title {
    font-size: $font-size-body; // 16px
    font-weight: $font-weight-medium;
    line-height: $line-height-body;
    color: $color-warning;
  }

  &__desc {
    font-size: $font-size-caption; // 12px
    line-height: $line-height-caption;
    color: $color-warning;
    opacity: 0.85;
  }

  &__arrow {
    flex-shrink: 0;
    color: $color-warning;
  }
}

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
