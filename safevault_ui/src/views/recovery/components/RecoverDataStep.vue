<script setup>
/**
 * RecoverDataStep —— 重置密码后取回数据：输入恢复码恢复 / 无恢复码时放弃旧数据重建（可复用）
 *
 * 密码重置后，此前以「旧密码包裹的 DataKey」已作废（store.pendingRecovery 为 true），
 * 直接进库只会得到空数据，且云备份 / 同步会因无 DataKey 静默失效。本步骤提供两条正式出路：
 *   - 主行动：输入注册时保存的「恢复码」取回 DataKey，找回此前全部数据（recoverWithCode）；
 *   - 次要行动（无恢复码兜底）：「放弃旧数据并重建」——经二次确认后生成全新钥匙 + 新恢复码、
 *     force 覆盖云端不可解密的旧备份（rebuildVault），随后展示新恢复码供保存，云备份/同步恢复正常。
 *
 * 复用场景：①重置流程步骤二（ResetPasswordView）；②设置页「数据待恢复」再入口（RecoverDataView）。
 * 交互编排（loading / 取消 / 反馈）就地完成；输入容忍大小写 / 连字符差异（归一化在密钥层）。
 */
import { ref, computed, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

import AppIcon from '@/components/icons/AppIcon.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import RecoveryCodeReveal from '@/components/RecoveryCodeReveal.vue'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { useVaultStore } from '@/stores/vault'

const emit = defineEmits(['done'])

const cloudStore = useCloudAccountStore()
const vaultStore = useVaultStore()

/** 用户输入的恢复码（展示态保留原样，提交时由密钥层归一化） */
const code = ref('')
/** 恢复进行中（loading 态，防重复提交） */
const recovering = ref(false)
/** 重建进行中（loading 态，防重复提交） */
const rebuilding = ref(false)
/** 「放弃旧数据并重建」二次确认面板显隐 */
const rebuildConfirm = ref(false)
/** 重建成功后待展示的新恢复码（非空即进入「展示新恢复码」态，替换输入区） */
const rebuiltCode = ref('')

/** 请求取消控制器（组件卸载时中断进行中的恢复请求） */
let abortController = null

/** 可提交：已输入非空且无进行中操作 */
const canSubmit = computed(
  () => code.value.trim().length > 0 && !recovering.value && !rebuilding.value
)

/** 确保存在可用的 AbortController */
function ensureSignal() {
  if (!abortController) abortController = new AbortController()
  return abortController.signal
}

/** 提交恢复码：成功进库；失败提示「恢复码不正确」留在原步骤可重试 */
async function handleRecover() {
  if (!canSubmit.value) return
  recovering.value = true
  try {
    const ok = await cloudStore.recoverWithCode(code.value, { signal: ensureSignal() })
    if (ok) {
      ElMessage.success('数据已恢复')
      emit('done')
    } else {
      ElMessage.error('恢复码不正确，请检查后重试')
    }
  } catch (err) {
    if (err?.name === 'AbortError') return
    ElMessage.error(err?.message || '恢复失败，请重试')
  } finally {
    recovering.value = false
  }
}

/** 点「没有恢复码，放弃旧数据并重建」：先弹二次确认（强调旧数据将永久丢失） */
function handleRebuild() {
  if (recovering.value || rebuilding.value) return
  rebuildConfirm.value = true
}

/**
 * 确认重建：库置空作为新基线 → 生成全新 DataKey + 新恢复码、force 覆盖云端旧备份（rebuildVault）。
 * 成功后进入「展示新恢复码」态让用户保存；失败留在原步骤可重试（pendingRecovery 未清，入口仍在）。
 */
async function doRebuild() {
  if (rebuilding.value) return
  rebuilding.value = true
  try {
    // 旧数据用旧钥匙加密、已不可解，库置空作为新基线（避免把残留 mock / 上一会话数据当作有效数据）
    vaultStore.clearAll()
    const newCode = await cloudStore.rebuildVault({ signal: ensureSignal() })
    if (newCode) {
      rebuiltCode.value = newCode // 进入「展示新恢复码」态
    } else {
      ElMessage.error('重建失败，请确认已登录后重试')
    }
  } catch (err) {
    if (err?.name === 'AbortError') return
    ElMessage.error(err?.message || '重建失败，请稍后重试')
  } finally {
    rebuilding.value = false
  }
}

/** 新恢复码已确认保存：清空一次性展示码后进库 */
function onRebuiltCodeSaved() {
  cloudStore.pendingRecoveryCode = ''
  rebuiltCode.value = ''
  emit('done')
}

onUnmounted(() => {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
})
</script>

<template>
  <main class="recover-step">
    <!-- 态一：重建成功后展示新恢复码（复用开户的展示组件，勾选确认后进库） -->
    <RecoveryCodeReveal
      v-if="rebuiltCode"
      :code="rebuiltCode"
      title="已重建并生成新恢复码"
      subtitle="旧数据已无法恢复。这是新的唯一凭据，仅显示这一次，请离线妥善保存。"
      confirm-text="完成"
      :show-legacy-hint="true"
      @confirm="onRebuiltCodeSaved"
    />

    <!-- 态二：输入恢复码恢复 / 无恢复码则放弃旧数据重建 -->
    <template v-else>
      <!-- 状态区：钥匙徽章 + 标题 + 说明 -->
      <div class="recover-status">
        <div class="recover-status__badge">
          <AppIcon name="recovery-key" :width="22" :height="22" />
        </div>
        <h1 class="recover-status__title">输入恢复码找回数据</h1>
        <p class="recover-status__desc">
          密码已重置。输入注册时保存的恢复码即可找回此前的全部数据；没有恢复码则旧数据无法恢复。
        </p>
      </div>

      <!-- 恢复码输入卡片 -->
      <section class="recover-card">
        <div class="recover-field">
          <label class="recover-field__label">恢复码</label>
          <input
            class="recover-field__input"
            type="text"
            v-model="code"
            placeholder="ABCD-EFGH-…"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            :disabled="recovering || rebuilding"
            @keydown.enter.prevent="handleRecover"
          />
        </div>
      </section>

      <!-- 主行动：恢复数据 -->
      <button
        type="button"
        class="recover-submit"
        :disabled="!canSubmit"
        @click="handleRecover"
      >
        <span>{{ recovering ? '恢复中…' : '恢复数据' }}</span>
        <AppIcon v-if="!recovering" name="arrow-right" :size="16" class="recover-submit__icon" />
      </button>

      <!-- 次要入口：无恢复码兜底——放弃旧数据并重建（带二次确认） -->
      <button
        type="button"
        class="recover-skip"
        :disabled="recovering || rebuilding"
        @click="handleRebuild"
      >
        {{ rebuilding ? '重建中…' : '没有恢复码？放弃旧数据并重建' }}
      </button>
    </template>

    <!-- 重建二次确认（强调旧数据将永久丢失，与清空回收站同款底部面板） -->
    <ConfirmSheet
      v-model="rebuildConfirm"
      title="放弃旧数据并重建？"
      message="没有恢复码将无法解密此前的数据。重建会以新密码生成全新钥匙、清空数据并签发新恢复码，此前的旧数据将永久丢失，且此操作不可撤销。"
      confirm-text="确认重建"
      cancel-text="再想想"
      tone="danger"
      @confirm="doRebuild"
    />
  </main>
</template>

<style lang="scss" scoped>
.recover-step {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 各区块 24px
  width: 100%;
  max-width: $layout-content-max-width;
  margin: 0 auto;
  padding: $spacing-xl $spacing-sm calc(#{$spacing-2xl} + env(safe-area-inset-bottom));
}

// ---- 状态区 ----
.recover-status {
  @include flex-col-center;

  &__badge {
    @include flex-center;
    @include circle(64px);
    margin-bottom: $spacing-sm; // 16px
    background-color: $color-health-bg;
    color: $color-health-text;
  }

  &__title {
    margin-top: $spacing-xs;
    font-size: $font-size-heading; // 20px
    font-weight: $font-weight-medium;
    line-height: $line-height-heading;
    color: $color-text-strong;
    text-align: center;
  }

  &__desc {
    margin-top: $spacing-xxs;
    max-width: 320px;
    font-size: $font-size-sm; // 14px
    line-height: $line-height-sm;
    color: $color-text-regular;
    text-align: center;
  }
}

// ---- 输入卡片 ----
.recover-card {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  padding: $spacing-sm;
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;
  box-shadow: $shadow-shield;

  &__hint-icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: $color-brand;
  }

  &__hint-text {
    font-size: $font-size-sm;
    line-height: $line-height-sm;
    color: $color-text-regular;
  }
}

// 恢复码输入字段（等宽，便于核对字符）
.recover-field {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;

  &__label {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-regular;
  }

  &__input {
    @include button-reset;
    width: 100%;
    height: 56px;
    padding: 0 $spacing-sm;
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-sm;
    font-family: $font-family-mono;
    font-size: $font-size-input; // 18px
    letter-spacing: $letter-spacing-code;
    color: $color-text-strong;
    cursor: text;
    transition:
      border-color $transition-base,
      box-shadow $transition-base;

    &::placeholder {
      letter-spacing: $letter-spacing-input;
      color: $color-text-muted;
    }

    &:focus {
      border-color: $color-brand;
      box-shadow: 0 0 0 3px rgba($color-brand, 0.12);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }
}

// ---- 主行动按钮 ----
.recover-submit {
  @include button-reset;
  @include flex-center;
  gap: $spacing-xs;
  width: 100%;
  height: 56px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  color: $color-white;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

  span {
    font-size: $font-size-list-title; // 15px
    font-weight: $font-weight-medium;
    line-height: $line-height-list-title;
  }

  &__icon {
    color: $color-white;
  }

  &:hover:not(:disabled) {
    filter: brightness(0.94);
  }

  &:active:not(:disabled) {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 3px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

// ---- 跳过（次要文字按钮）----
.recover-skip {
  @include button-reset;
  @include flex-center;
  width: 100%;
  height: 44px;
  color: $color-text-muted;
  font-size: $font-size-sm; // 14px
  line-height: $line-height-sm;
  transition: opacity $transition-base;

  &:hover:not(:disabled) {
    opacity: 0.7;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid rgba($color-brand, 0.4);
    outline-offset: 2px;
    border-radius: $radius-sm;
  }
}
</style>
