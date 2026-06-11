<script setup>
/**
 * PasswordDetailView —— 密码详情页（带删除验证）
 *
 * 像素级还原 Figma「密码详情页-带删除验证」(node 1:596)。
 * 结构（自上而下）：
 *   1. 顶部导航：返回 + 更新
 *   2. 身份卡：图标字标 + 平台名 + 分类
 *   3. Bento 信息卡：账号 / 密码（含显隐倒计时环）/ 网址 / 分类 + 删除入口
 *   4. 底部双按钮：复制账号 / 复制密码
 *   5. 删除流程：点击删除直接进入身份验证界面（指纹 / 主密码），通过后删除并返回
 *
 * 交互编排复用 usePasswordDetail（显隐、复制反馈）；
 * 删除须经 IdentityVerifyModal 双因子验证（指纹或主密码）通过后从 store 移除条目。
 */
import {ref, computed} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {storeToRefs} from 'pinia'

import AppIcon from '@/components/icons/AppIcon.vue'
import IdentityVerifyModal from '@/components/IdentityVerifyModal.vue'
import DetailHeader from './components/DetailHeader.vue'
import InfoSection from './components/InfoSection.vue'

import {useVaultStore} from '@/stores/vault'
import {useSettingsStore} from '@/stores/settings'
import {usePasswordDetail} from '@/composables/usePasswordDetail'
import {useBiometricPrompt} from '@/composables/useBiometricPrompt'
import {useSheetDismiss} from '@/composables/useSheetDismiss'
import {maskAccountText} from '@/utils/maskAccount'

const route = useRoute()
const router = useRouter()
const vaultStore = useVaultStore()

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回
const {sheetRoot, sheetStyle, onTouchStart, onTouchMove, onTouchEnd} = useSheetDismiss()

/** 当前条目（删除后变为 null） */
const entry = computed(() => vaultStore.getEntry(route.params.id))

// 账号展示：开启「账号脱敏显示」时打码（复制账号仍取真实明文）；biometric：是否已启用指纹
const {maskAccount, biometric} = storeToRefs(useSettingsStore())
// 与登录解锁共用同一指纹流程（真机直接拉起系统指纹框）
const {requestBiometric} = useBiometricPrompt()
const displayAccount = computed(() =>
  maskAccount.value ? maskAccountText(entry.value?.account) : entry.value?.account ?? ''
)

// 非法 id：直接回密码库
if (!entry.value) {
  router.replace({name: 'Vault'})
}

const {revealed, toggleReveal, copyAccount, copyPassword} =
    usePasswordDetail(entry)

/** 掩码密码（按真实长度，避免泄露位数过多用上限） */
const maskedPassword = computed(() => '●'.repeat(Math.min(entry.value?.password.length ?? 12, 16)))

/** 分类标签 */
const categoryLabel = computed(() => {
  const cat = vaultStore.categories.find((c) => c.key === entry.value?.category)
  return cat?.label ?? '未分类'
})

/** 网址可点击链接（缺协议时补 https） */
const urlHref = computed(() => {
  const u = entry.value?.url?.trim()
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
})

// ---- 删除流程 ----
/** 删除身份验证界面显隐 */
const verifyVisible = ref(false)

/**
 * 点击删除入口 → 与登录解锁完全一致的指纹验证：
 *   - 已启用指纹：直接拉起系统指纹框（真机系统指纹 / 浏览器 mock），通过即删除；
 *     用户取消静默留在本页，真实错误由 requestBiometric 内部 ElMessage 提示。
 *   - 未启用指纹：回退到主密码验证弹窗（IdentityVerifyModal）。
 */
async function onDeleteClick() {
  if (biometric.value) {
    const ok = await requestBiometric('verify')
    if (ok) onDeleteVerified()
    return
  }
  verifyVisible.value = true
}

/** 验证通过 → 删除并返回 */
function onDeleteVerified() {
  const id = entry.value?.id
  verifyVisible.value = false
  if (id) vaultStore.deleteEntry(id)
  ElMessage.success('已移至回收站，30 天内可恢复')
  router.replace({name: 'Vault'})
}

/** 更新：进入编辑页（复用新增页表单，带 :id 为编辑模式） */
function onUpdate() {
  if (entry.value) {
    router.push({ name: 'EditPassword', params: { id: entry.value.id } })
  }
}
</script>

<template>
  <div
    class="detail-page"
    ref="sheetRoot"
    :style="sheetStyle"
    @touchstart.passive="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <DetailHeader :title="entry?.name ?? ''" @update="onUpdate"/>

    <template v-if="entry">
      <main class="detail-page__main">
        <!-- 身份卡 -->
        <div class="identity-card">
          <div class="identity-card__icon" aria-hidden="true">{{ entry.monogram }}</div>
          <h2 class="identity-card__name">{{ entry.name }}</h2>
          <p class="identity-card__sub">{{ categoryLabel }}平台</p>
        </div>

        <!-- Bento 信息卡 -->
        <div class="detail-sections">
          <!-- 账号 -->
          <InfoSection label="账号">
            <div class="detail-row">
              <span class="detail-value">{{ displayAccount }}</span>
            </div>
          </InfoSection>

          <!-- 密码 -->
          <InfoSection label="密码">
            <div class="detail-row">
              <span class="detail-value detail-value--secret" :class="{ 'is-masked': !revealed }">
                {{ revealed ? entry.password : maskedPassword }}
              </span>
              <button
                  type="button"
                  class="detail-icon-btn"
                  :aria-label="revealed ? '隐藏密码' : '显示密码'"
                  @click="toggleReveal"
              >
                <AppIcon :name="revealed ? 'eye' : 'eye-off'" :width="22" :height="19.8"/>
              </button>
            </div>
          </InfoSection>

          <!-- 网址（可选：填写后才显示，可点击打开） -->
          <InfoSection v-if="entry.url" label="网址">
            <div class="detail-row">
              <a
                  class="detail-link"
                  :href="urlHref"
                  target="_blank"
                  rel="noopener noreferrer"
              >{{ entry.url }}</a>
            </div>
          </InfoSection>

          <!-- 分类（横向卡，可选：归类后才显示） -->
          <section v-if="entry.category" class="category-card">
            <div class="category-card__left">
              <span class="category-card__label">分组</span>
              <div class="category-card__value">
                <span class="category-card__dot" :class="`is-${entry.category}`"></span>
                <span class="category-card__name">{{ categoryLabel }}</span>
              </div>
            </div>
          </section>

          <!-- 备注（可选：填写后才显示） -->
          <InfoSection v-if="entry.note" label="备注">
            <p class="detail-note">{{ entry.note }}</p>
          </InfoSection>

          <!-- 删除入口 -->
          <button type="button" class="detail-delete" @click="onDeleteClick">
            <AppIcon name="trash" :width="13.33" :height="15"/>
            <span>删除此密码</span>
          </button>
        </div>
      </main>

      <!-- 底部双按钮 -->
      <footer class="detail-page__footer">
        <button type="button" class="detail-action detail-action--ghost" @click="copyAccount">
          <AppIcon name="person" :size="16"/>
          <span>复制账号</span>
        </button>
        <button type="button" class="detail-action detail-action--primary" @click="copyPassword">
          <AppIcon name="shield-lock" :width="16" :height="21"/>
          <span>复制密码</span>
        </button>
      </footer>
    </template>

    <!-- 删除身份验证：指纹已在外层走系统指纹框（与登录一致），此弹窗仅作未开启指纹时的主密码兜底 -->
    <IdentityVerifyModal
      v-model="verifyVisible"
      title="验证身份以删除"
      hint="删除后将移至回收站，30 天内可恢复。"
      confirm-text="确认删除"
      tone="danger"
      :allow-biometric="false"
      @verified="onDeleteVerified"
    />
  </div>
</template>

<style lang="scss" scoped>
.detail-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh; // 固定外壳：header / footer 常驻，主体内部滚动
  background-color: $color-bg-page;
  overflow: hidden;

  &__main {
    flex: 1;
    min-height: 0; // 关键：允许 flex 子项收缩到视口内，内部 overflow 才生效
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    gap: $spacing-lg; // 身份卡与信息区 24px
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-top $spacing-sm $spacing-lg;
  }

  // ---- 底部双按钮 ----
  &__footer {
    flex-shrink: 0;
    display: flex;
    gap: $spacing-2xs; // 12px
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: ($spacing-sm + 1px) $spacing-sm $spacing-sm; // 上 17 / 左右 16 / 下 16
    padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom));
    background-color: $color-bg-page;
    border-top: 1px solid $color-border;
  }
}

// ---- 身份卡 ----
.identity-card {
  @include flex-col-center;
  width: 100%;
  padding: $spacing-lg;
  background-color: $color-bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  // 字标图标方块
  &__icon {
    @include flex-center;
    width: 80px;
    height: 80px;
    margin-bottom: $spacing-sm;
    background-color: $color-brand-pale;
    border-radius: $radius-lg;
    font-size: $font-size-title; // 24px
    font-weight: $font-weight-bold;
    color: $color-brand;
  }

  &__name {
    font-size: $font-size-list-title; // 17px
    font-weight: $font-weight-bold;
    line-height: $line-height-list-title;
    color: $color-text-strong;
  }

  &__sub {
    margin-top: 2px;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
  }
}

// ---- 信息卡组 ----
.detail-sections {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm; // 卡间距 16px
}

// 值 + 操作行
.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-xs;
  width: 100%;
}

.detail-value {
  min-width: 0;
  font-family: $font-family-mono;
  font-size: $font-size-input; // 18px
  font-weight: $font-weight-medium;
  line-height: 26px;
  letter-spacing: $letter-spacing-value;
  color: $color-text-strong;
  @include text-ellipsis;

  // 掩码态弱化
  &--secret.is-masked {
    color: $color-text-muted;
    letter-spacing: 1px;
  }
}

// 网址链接（常规字体，品牌色，可点击打开）
.detail-link {
  min-width: 0;
  font-size: $font-size-input; // 18px
  font-weight: $font-weight-medium;
  line-height: 26px;
  color: $color-brand;
  text-decoration: none;
  @include text-ellipsis;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
    border-radius: $radius-sm;
  }
}

// 备注（多行文本，保留换行）
.detail-note {
  width: 100%;
  font-size: $font-size-body; // 16px
  line-height: $line-height-body;
  color: $color-text-strong;
  white-space: pre-wrap;
  word-break: break-word;
}

// 纯图标按钮（显隐密码）
.detail-icon-btn {
  @include button-reset;
  @include flex-center;
  flex-shrink: 0;
  padding: $spacing-xs;
  border-radius: $radius-sm;
  color: $color-text-regular;
  transition: background-color $transition-base,
  color $transition-base;

  &:hover {
    color: $color-text-strong;
    background-color: rgba($line-base, 0.25);
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }
}

// 倒计时环
.detail-timer {
  position: relative;
  width: 24px;
  height: 24px;

  &__ring {
    display: block;
  }

  &__track {
    fill: none;
    stroke: $color-brand-pale;
    stroke-width: 2;
  }

  &__progress {
    fill: none;
    stroke: $color-brand;
    stroke-width: 2;
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear;
  }

  &__text {
    position: absolute;
    inset: 0;
    @include flex-center;
    font-family: $font-family-base;
    font-size: $font-size-micro; // 10px
    font-weight: $font-weight-bold;
    line-height: $line-height-micro;
    color: $color-brand;
  }
}

// ---- 分类横向卡 ----
.category-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: $spacing-lg - 3px; // 21px
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;

  &__left {
    display: flex;
    flex-direction: column;
    gap: $spacing-xxs; // 4px
    min-width: 0;
  }

  &__label {
    font-family: $font-family-mono;
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-bold;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-label;
    text-transform: uppercase;
    color: $color-text-muted;
  }

  &__value {
    display: flex;
    align-items: center;
    gap: $spacing-xs; // 8px
  }

  &__dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: $radius-pill;
    background-color: $color-text-muted;

    // 分类语义色（社交绿对齐 Figma，其余合理分色）
    &.is-social {
      background-color: $color-success-strong;
    }

    &.is-finance {
      background-color: $color-brand;
    }

    &.is-shopping {
      background-color: $color-warning;
    }

    &.is-work {
      background-color: $color-brand-bright;
    }

    &.is-email {
      background-color: $color-danger;
    }
  }

  &__name {
    font-size: $font-size-body; // 16px
    line-height: $line-height-body;
    color: $color-text-strong;
  }

  &__action {
    @include button-reset;
    @include flex-center;
    flex-shrink: 0;
    padding: $spacing-xs;
    border-radius: $radius-sm;
    color: $color-text-regular;
    transition: background-color $transition-base,
    color $transition-base;

    &:hover {
      color: $color-text-strong;
      background-color: rgba($line-base, 0.25);
    }

    &:focus-visible {
      outline: 2px solid rgba($color-brand, 0.4);
      outline-offset: 2px;
    }
  }
}

// ---- 删除入口 ----
.detail-delete {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs;
  align-self: center;
  margin-top: $spacing-xs;
  padding: $spacing-xs $spacing-sm;
  border-radius: $radius-sm;
  color: $color-danger;
  transition: background-color $transition-base;

  span {
    font-size: $font-size-body; // 16px
    line-height: $line-height-body;
  }

  &:hover {
    background-color: rgba($color-danger, 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgba($color-danger, 0.4);
    outline-offset: 2px;
  }
}

// ---- 底部操作按钮 ----
.detail-action {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs;
  flex: 1;
  min-width: 0;
  height: 56px;
  border-radius: $radius-md;
  font-size: $font-size-body; // 16px
  line-height: $line-height-body;
  transition: background-color $transition-base,
  filter $transition-base,
  transform $transition-fast;

  &:active {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  // 复制账号（次要）
  &--ghost {
    background-color: $color-brand-pale;
    color: $color-brand;

    &:hover {
      background-color: rgba($color-brand, 0.16);
    }
  }

  // 复制密码（主）
  &--primary {
    background-color: $color-brand;
    color: $color-white;
    box-shadow: $shadow-fab;

    &:hover {
      filter: brightness(0.94);
    }
  }
}
</style>
