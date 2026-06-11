<script setup>
/**
 * PrivacyPolicyView —— 隐私政策（独立右侧弹出页）
 *
 * 入口：设置「关于 → 隐私政策」。承载 SafeVault 的隐私政策正文，沿用项目
 * header / main 滚动三段式骨架（顶部返回 + 标题，主体内部滚动）。
 *
 * 正文以 SECTIONS 数据驱动渲染（小标题 + 段落 / 要点列表），便于维护与改文案。
 * 内容对齐应用真实特性：零知识端到端加密、主密码与恢复码不出本机、云端仅存密文 blob、
 * 生物识别 / 剪贴板 / 相册等本机权限的有限使用。纯展示页，无业务状态。
 */
import { useRouter } from 'vue-router'

import AppIcon from '@/components/icons/AppIcon.vue'
import { useSheetDismiss } from '@/composables/useSheetDismiss'

const router = useRouter()

/**
 * 隐私政策正文：每节含小标题 title，正文按 paragraphs（普通段落）与
 * bullets（要点列表）两种块组织，模板按存在与否分别渲染。
 */
const SECTIONS = [
  {
    title: '我们的承诺',
    paragraphs: [
      'SafeVault 是一款零知识（Zero-Knowledge）密码管理工具。你的所有密码、备注等敏感数据，都在你的设备本机用主密码派生的密钥加密后才会离开应用，我们与任何第三方都无法读取其明文。'
    ]
  },
  {
    title: '本地加密与主密码',
    paragraphs: [
      '主密码是解密你保险库的唯一钥匙，它只存在于你的设备本机，从不以任何形式上传至服务器。我们因此无法帮你找回主密码——这也是零知识设计的代价与保障。'
    ],
    bullets: [
      '保险库内容在本机完成加密 / 解密，服务端永远只接触密文。',
      '恢复码用于忘记主密码时恢复数据，同样由你保管，不会明文上传。'
    ]
  },
  {
    title: '我们收集的信息',
    paragraphs: ['为提供账户与云备份服务，我们仅收集必要的最少信息：'],
    bullets: [
      '账户邮箱：用于登录、找回密码与重要安全通知。',
      '加密备份数据：仅当你开启「云备份」时上传，且为无法解密的密文 blob。',
      '基础运行信息：为保障服务安全与稳定所需的设备型号、系统版本与错误日志，不含保险库内容。'
    ]
  },
  {
    title: '云端备份',
    paragraphs: [
      '云备份为可选功能，默认关闭。开启后，应用会把本机加密好的密文快照上传至服务器，用于跨设备恢复。由于上传前已在本机加密，服务端及其运维人员均无法查看你的密码内容。你可随时在「设置 → 数据」中关闭云备份或彻底删除云端备份。'
    ]
  },
  {
    title: '设备权限',
    paragraphs: ['我们仅在实现对应功能时请求以下权限，且严格限定用途：'],
    bullets: [
      '生物识别（指纹 / 面容）：仅在你的设备本机完成身份校验，用于快捷解锁，特征数据不离开设备。',
      '剪贴板：复制密码等敏感信息后，约 60 秒自动清除，降低被其他应用读取的风险。',
      '相册 / 存储：仅在你主动保存恢复码图片时使用。'
    ]
  },
  {
    title: '信息共享',
    paragraphs: [
      '我们不会出售你的个人信息，也不会将其共享给第三方用于营销。仅在法律法规明确要求、或为保护用户与公众安全所必需时，才会在合法范围内披露相关信息。'
    ]
  },
  {
    title: '数据留存与删除',
    paragraphs: [
      '云端备份会在你开启云备份期间持续保留。你可随时删除云端备份或注销账户；账户注销后，我们将依据法律要求的最短期限清除与你账户关联的服务器数据。本机数据可通过卸载应用或清除应用数据移除。'
    ]
  },
  {
    title: '政策更新',
    paragraphs: [
      '我们可能不时更新本隐私政策。涉及你权益的重大变更，我们会通过应用内提示或邮件告知。继续使用 SafeVault 即表示你接受更新后的政策。'
    ]
  },
  {
    title: '联系我们',
    paragraphs: [
      '如对本隐私政策或你的数据有任何疑问，欢迎通过 privacy@safevault.app 与我们联系。'
    ]
  }
]

/** 返回：有历史则后退，否则回设置页 */
function handleBack() {
  if (window.history.length > 1) router.back()
  else router.replace({ name: 'Settings' })
}

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回
const { sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd } = useSheetDismiss({
  onDismiss: handleBack
})
</script>

<template>
  <div
    class="privacy-page"
    ref="sheetRoot"
    :style="sheetStyle"
    @touchstart.passive="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- 顶部导航 -->
    <header class="privacy-header">
      <button type="button" class="privacy-header__back" aria-label="返回" @click="handleBack">
        <AppIcon name="arrow-left" :size="16" />
      </button>
      <h1 class="privacy-header__title">隐私政策</h1>
      <span class="privacy-header__placeholder" aria-hidden="true"></span>
    </header>

    <main class="privacy-page__main">
      <section v-for="(sec, i) in SECTIONS" :key="i" class="privacy-section">
        <h2 class="privacy-section__title">{{ sec.title }}</h2>
        <p
          v-for="(p, pi) in sec.paragraphs"
          :key="`p-${pi}`"
          class="privacy-section__para"
        >
          {{ p }}
        </p>
        <ul v-if="sec.bullets" class="privacy-section__list">
          <li v-for="(b, bi) in sec.bullets" :key="`b-${bi}`" class="privacy-section__item">
            {{ b }}
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.privacy-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh; // 固定外壳：header 常驻，主体内部滚动
  background-color: $color-bg-page;
  overflow: hidden;

  &__main {
    flex: 1;
    min-height: 0; // 允许 flex 子项收缩，内部 overflow 才生效
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    gap: $spacing-lg;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-md $layout-page-padding $spacing-2xl;
  }
}

// ---- 顶部导航（与分类管理 / 回收站同构）----
.privacy-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-xs;
  height: calc(#{$layout-header-height} + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) $spacing-sm 0;
  background-color: $color-bg-header;

  &__back {
    @include button-reset;
    @include flex-center;
    @include circle($size-touch-min);
    flex-shrink: 0;
    color: $color-link;
    transition: background-color $transition-base;

    &:hover {
      background-color: rgba($color-link, 0.06);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-link, 0.4);
      outline-offset: 2px;
    }
  }

  &__title {
    flex: 1;
    text-align: center;
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  // 占位：与返回按钮对称，标题保持居中
  &__placeholder {
    flex-shrink: 0;
    width: $size-touch-min;
  }
}

// ---- 正文 ----
.privacy-updated {
  font-size: $font-size-caption; // 12px
  line-height: $line-height-caption;
  color: $color-text-placeholder;
}

.privacy-section {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;

  &__title {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__para {
    font-size: $font-size-sm; // 14px
    line-height: 1.7;
    color: $color-text-regular;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: $spacing-2xs;
    margin: 0;
    padding-left: $spacing-md;
  }

  &__item {
    font-size: $font-size-sm; // 14px
    line-height: 1.7;
    color: $color-text-regular;
  }
}
</style>
