<script setup>
/**
 * AddPasswordView —— 新增 / 编辑密码页（uni-app 版）
 *
 * 像素级还原 Figma「新增密码页-中文版」(node 1:339)。
 * 兼作编辑密码页：路由带 ?id=（源 /vault/:id/edit）时进入编辑模式，预填该条目并改走更新逻辑。
 * 结构（自上而下，沿用项目 header / main滚动 / footer 三段式）：
 *   1. 顶部导航：返回 + 标题（新增「新增密码」/ 编辑「编辑密码」）
 *   2. 滚动主体：Hero 装饰区 + 表单卡片（名称 / 账号 / 密码 / 网址 / 分类 / 备注）
 *   3. 底部毛玻璃操作栏：保存按钮（名称 + 账号 + 密码必填方可提交）
 *
 * 交互编排复用 useAddPassword：模拟保存延迟，成功后新增回密码库列表 / 编辑回该条目详情页。
 *
 * 迁移要点（vue-router → uni）：
 *   - route.params.id → onLoad((q)=>editId.value=q.id||'')；有 id 即编辑模式；
 *   - 编辑预填移入 onLoad 回调（setup 顶层时 editId 尚为空，不能同步预填）；
 *   - router.replace → navReplace；
 *   - 这是 SHEET 子页：根节点接 useSheetDismiss 左滑收回手势；软键盘开合用 useSoftKeyboard；
 *   - 高度单位 100lvh → 100vh（uni 部分端不支持 lvh）。
 */
import { ref, reactive, computed, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

import AddPasswordHeader from './components/AddPasswordHeader.vue'
import AddPasswordHero from './components/AddPasswordHero.vue'
import FormField from './components/FormField.vue'
import GeneratePasswordField from './components/GeneratePasswordField.vue'
import CategorySelect from './components/CategorySelect.vue'
import AppIcon from '@/components/icons/AppIcon.vue'

import { navReplace, navBack, decodeParam } from '@/utils/navigation'
import { useVaultStore } from '@/stores/vault'
import { useAddPassword } from '@/composables/useAddPassword'
import { useSheetDismiss } from '@/composables/useSheetDismiss'
import { useSoftKeyboard } from '@/composables/useSoftKeyboard'

const vaultStore = useVaultStore()
const { saving, savePassword, updatePassword, generatePassword, cleanup } = useAddPassword()

// 左滑返回手势：作为右侧弹出页，在屏幕上向左滑动即返回
const { sheetStyle, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useSheetDismiss()

// 软键盘开合侦测：弹出时收起底部保存栏，避免被 adjustResize 顶到键盘上方悬浮在表单上
const { keyboardOpen } = useSoftKeyboard()

/** 编辑模式：路由带 ?id= 时为编辑已有条目，否则为新增（editIdRaw 由 onLoad 赋值） */
const editIdRaw = ref('')
const isEdit = computed(() => !!editIdRaw.value)

/** 表单字段集中收集 */
const form = reactive({
  name: '',
  account: '',
  password: '',
  url: '',
  category: '',
  note: ''
})

// 取参 + 编辑预填：源工程在 setup 同步做，uni 下 id 经 onLoad 取得，故预填移入回调。
onLoad((query) => {
  // App 端 onLoad query 可能未自动解码，含中文的条目 id 需经 decodeParam 还原才能命中。
  editIdRaw.value = decodeParam(query && query.id)
  if (!isEdit.value) return
  const editing = vaultStore.getEntry(editIdRaw.value)
  if (!editing) {
    // 非法 id 直接回密码库
    navReplace('Vault')
    return
  }
  form.name = editing.name ?? ''
  form.account = editing.account ?? ''
  form.password = editing.password ?? ''
  form.url = editing.url ?? ''
  // store 存的是分类 key，CategorySelect 的 v-model 是 label 文本，需反查
  form.category =
    vaultStore.categories.find((c) => c.key === editing.category)?.label ?? ''
  form.note = editing.note ?? ''
})

/** 分类候选项（取真实分类标签，排除「全部」） */
const categoryOptions = computed(() =>
  vaultStore.categories.filter((c) => c.key !== 'all').map((c) => c.label)
)

/** 可提交：名称、账号、密码均非空，且非保存中 */
const canSubmit = computed(
  () =>
    form.name.trim().length > 0 &&
    form.account.trim().length > 0 &&
    form.password.length > 0 &&
    !saving.value
)

/** 备注输入（uni textarea 取 e.detail.value） */
function onNoteInput(event) {
  form.note = event.detail?.value ?? event.target?.value ?? ''
}

/** 一键生成强密码并填入 */
function handleGenerate() {
  form.password = generatePassword()
}

/** 提交保存（新增 / 编辑） */
async function handleSubmit() {
  if (!canSubmit.value) return
  // 解析分类：输入了候选外的新分类则即时建组（并入主页分类列表），
  // 已存在则复用；统一取分类 key 入库，保证条目能在对应分类下被筛出。空则不归类。
  const category = vaultStore.addCategory(form.category)
  const payload = { ...form, category: category ? category.key : '' }

  if (isEdit.value) {
    const entry = await updatePassword(editIdRaw.value, payload)
    if (entry) {
      // 编辑完成返回上一页（原详情页）。
      // 详情页 entry 是 computed(() => vaultStore.getEntry(id))，
      // store 更新后 computed 自动重算，回到前台即展示最新数据。
      // 旧方案用 navReplace('PasswordDetail') 会走 redirectTo，
      // 只替换栈顶 edit→new detail，旧 detail 仍在栈中，
      // 导致左滑回退时又进入一遍重复的详情页。
      navBack()
    }
  } else {
    const entry = await savePassword(payload)
    if (entry) {
      navReplace('Vault')
    }
  }
}

// 离开页面时取消未完成的保存请求
onUnmounted(cleanup)
</script>

<template>
  <view
    class="add-page"
    :style="sheetStyle"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <AddPasswordHeader :title="isEdit ? '编辑密码' : '新增密码'" />

    <!-- Hero 装饰区：固定顶部，不随表单滚动。矢量实现（CSS 渐变 + 矢量盾牌图标），
         任意屏幕 DPR 均锐利，取代原低分辨率位图 add-hero.png -->
    <view class="add-page__hero">
      <AddPasswordHero />
    </view>

    <view class="add-page__main">
      <!-- 表单卡片 -->
      <view class="add-form">
        <FormField
          v-model="form.name"
          label="名称/平台"
          placeholder="例如：微信、GitHub、QQ"
          required
          :disabled="saving"
          @submit="handleSubmit"
        >
          <template #icon>
            <AppIcon name="globe" :size="18" />
          </template>
        </FormField>

        <FormField
          v-model="form.account"
          label="用户"
          placeholder="邮箱或账号"
          required
          :disabled="saving"
          @submit="handleSubmit"
        >
          <template #icon>
            <AppIcon name="person" :width="16" :height="16" />
          </template>
        </FormField>

        <GeneratePasswordField
          v-model="form.password"
          :disabled="saving"
          @generate="handleGenerate"
          @submit="handleSubmit"
        />

        <FormField
          v-model="form.url"
          label="网址 / URL"
          placeholder="https://example.com"
          type="url"
          :disabled="saving"
          @submit="handleSubmit"
        >
          <template #icon>
            <AppIcon name="link" :size="18" />
          </template>
        </FormField>

        <!-- 分类：可选可输入（chips 标签式，规避原生 datalist 闪退） -->
        <CategorySelect
          v-model="form.category"
          :options="categoryOptions"
          :disabled="saving"
        />

        <!-- 备注 -->
        <view class="add-form__field">
          <text class="add-form__label">备注</text>
          <textarea
            class="add-form__textarea"
            :value="form.note"
            placeholder="恢复码、备用邮箱等..."
            placeholder-style="color: #9aa3b2;"
            :disabled="saving"
            @input="onNoteInput"
          />
        </view>
      </view>
    </view>

    <!-- 底部毛玻璃操作栏：软键盘弹出时收起，避免被 adjustResize 顶起悬浮在表单上 -->
    <view class="add-page__footer" :class="{ 'is-collapsed': keyboardOpen }">
      <button
        type="button"
        class="add-submit"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.add-page {
  display: flex;
  flex-direction: column;
  // 用大视口高度（uni 下 100vh）：软键盘弹出时容器高度不缩减，
  // 底部保存栏稳定停在页面底部被键盘覆盖（收起键盘即可点保存），不会被顶起。
  height: 100vh;
  background-color: $color-bg-page;
  overflow: hidden;

  // ---- Hero 装饰区：固定顶部 ----
  &__hero {
    flex-shrink: 0;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-xs $spacing-sm $spacing-xl; // 顶 8 / 左右 16 / 底 32（与表单留白）
  }

  // ---- 主体：可滚动 ----
  &__main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: 0 $spacing-sm $spacing-2xl; // 左右 16 / 底 40
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  // ---- 底部毛玻璃操作栏 ----
  &__footer {
    flex-shrink: 0;
    width: 100%;
    max-width: $layout-content-max-width;
    margin: 0 auto;
    padding: $spacing-sm;
    padding-bottom: calc(#{$spacing-sm} + env(safe-area-inset-bottom));
    background-color: $color-bg-frost; // 半透明页面底
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);

    // 软键盘弹出时收起：移出布局，主体占满键盘上方区域，保存栏不再被顶起悬浮
    &.is-collapsed {
      display: none;
    }
  }
}

// ---- 表单卡片 ----
.add-form {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg; // 字段之间 24px
  width: 100%;
  padding: $spacing-lg; // 24px（设计 25px，取栅格）
  background-color: $color-bg-card;
  border: 1px solid rgba($line-base, 0.3);
  border-radius: $radius-md;
  box-shadow: $shadow-button;

  // 备注字段结构
  &__field {
    display: flex;
    flex-direction: column;
    gap: $spacing-xs; // 8px
    width: 100%;
  }

  &__label {
    font-size: $font-size-caption; // 12px
    font-weight: $font-weight-medium;
    line-height: $line-height-caption;
    letter-spacing: $letter-spacing-caption;
    color: $color-text-regular;
  }

  &__textarea {
    @include button-reset;
    width: 100%;
    min-height: 96px;
    padding: $spacing-2xs $spacing-sm + 1px; // 上下 12 / 左右 17
    background-color: $color-bg-input;
    border: 1px solid $color-border;
    border-radius: $radius-md;
    font-family: $font-family-base;
    font-size: $font-size-body; // 16px
    line-height: $line-height-body;
    color: $color-text-strong;
    cursor: text;
    box-sizing: border-box;
    transition:
      border-color $transition-base,
      box-shadow $transition-base;

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

// ---- 底部保存按钮 ----
.add-submit {
  @include button-reset;
  @include flex-center;
  width: 100%;
  height: 52px;
  background-color: $color-brand;
  border-radius: $radius-md;
  box-shadow: $shadow-button;
  color: $color-white;
  font-size: $font-size-body; // 16px
  font-weight: $font-weight-medium;
  line-height: $line-height-body;
  transition:
    filter $transition-base,
    transform $transition-fast,
    opacity $transition-base;

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
</style>
