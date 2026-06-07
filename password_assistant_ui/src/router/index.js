import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { tabIndexOf } from '@/constants/tabs'
import { routeTransition, outerTransition } from '@/router/transition'

// 走模态卡片式滑动的表单页（新增 / 编辑密码）
const SHEET_ROUTES = new Set(['AddPassword', 'EditPassword'])

/**
 * 路由表
 * 解锁页为应用入口；其余业务页面采用懒加载，按需分包。
 */
const routes = [
  {
    path: '/unlock',
    name: 'Unlock',
    // 解锁页是首屏入口，直接静态引入以保证首屏速度
    component: () => import('@/views/unlock/UnlockView.vue'),
    meta: { title: '解锁 SafeVault', fullscreen: true }
  },
  {
    path: '/unlock/master',
    name: 'MasterPassword',
    // 主密码解锁页：属于解锁流程内的子页面，无需 requiresUnlock 守卫
    component: () => import('@/views/unlock/PasswordView.vue'),
    meta: { title: '主密码解锁', fullscreen: true }
  },
  {
    path: '/recovery',
    name: 'RecoveryCode',
    // 找回访问权限·步骤 1/2：验证恢复码。用户被锁在外面时进入，无需 requiresUnlock
    component: () => import('@/views/recovery/RecoveryCodeView.vue'),
    meta: { title: '找回访问权限', fullscreen: true }
  },
  {
    path: '/recovery/reset',
    name: 'ResetPassword',
    // 找回访问权限·步骤 2/2：重设主密码。恢复码验证通过后进入
    component: () => import('@/views/recovery/ResetPasswordView.vue'),
    meta: { title: '重设主密码', fullscreen: true }
  },
  {
    // 主导航常驻外壳：固定顶栏 + 底栏由它提供，库 / 健康为其内容子路由。
    // requiresUnlock 提到父级，统一守卫两个 Tab；URL 仍为 /vault、/health。
    path: '/',
    component: () => import('@/views/MainTabLayout.vue'),
    meta: { requiresUnlock: true },
    children: [
      {
        // 应用入口：访问 / 时重定向到解锁页（重定向短路，外壳不渲染）
        path: '',
        redirect: '/unlock'
      },
      {
        path: 'vault',
        name: 'Vault',
        // 密码库主页：解锁成功后的落地页
        component: () => import('@/views/vault/VaultView.vue'),
        // tab: 'vault' 标记其为主导航 Tab 页，参与 Tab 间横向滑动过渡
        meta: { title: '密码库', tab: 'vault' }
      },
      {
        path: 'health',
        name: 'Health',
        // 密码健康度页：底部导航「健康」Tab 落地页
        component: () => import('@/views/health/HealthView.vue'),
        // tab: 'health' 标记其为主导航 Tab 页，参与 Tab 间横向滑动过渡
        meta: { title: '密码健康度', tab: 'health' }
      },
      {
        path: 'generate',
        name: 'Generate',
        // 密码生成器页：底部导航「生成」Tab 落地页
        component: () => import('@/views/generate/GenerateView.vue'),
        // tab: 'generate' 标记其为主导航 Tab 页，参与 Tab 间横向滑动过渡
        meta: { title: '密码生成器', tab: 'generate' }
      },
      {
        path: 'settings',
        name: 'Settings',
        // 设置页：底部导航「设置」Tab 落地页
        component: () => import('@/views/settings/SettingsView.vue'),
        // tab: 'settings' 标记其为主导航 Tab 页，参与 Tab 间横向滑动过渡
        meta: { title: '设置', tab: 'settings' }
      }
    ]
  },
  {
    path: '/settings/change-password',
    name: 'ChangeMasterPassword',
    // 修改主密码：从设置「安全 → 修改主密码」进入，需已解锁。
    // 同页完成「验证当前主密码 + 设置新密码」，依 DRD 4.12「修改主密码需先验证旧凭证」。
    component: () => import('@/views/change-password/ChangePasswordView.vue'),
    meta: { title: '修改主密码', requiresUnlock: true }
  },
  {
    path: '/settings/recovery-code',
    name: 'RecoveryCodeManage',
    // 恢复码管理（重新生成并保存）：从设置「安全 → 恢复码管理」进入，需已解锁。
    // 进入即要求身份验证，通过后揭示并生成新恢复码。
    component: () => import('@/views/recovery-code/RecoveryCodeManageView.vue'),
    meta: { title: '恢复码管理', requiresUnlock: true }
  },
  {
    path: '/settings/trash',
    name: 'Trash',
    // 回收站：从设置「数据 → 回收站」进入，需已解锁。承载软删除条目，可恢复 / 彻底删除 / 清空。
    component: () => import('@/views/trash/TrashView.vue'),
    meta: { title: '回收站', requiresUnlock: true }
  },
  {
    path: '/vault/add',
    name: 'AddPassword',
    // 新增密码页：从密码库「+」进入，需已解锁。独立成 views/add 模块。
    // 必须先于 /vault/:id 注册，否则 add 会被动态段当作 id 匹配
    component: () => import('@/views/add/AddPasswordView.vue'),
    meta: { title: '新增密码', requiresUnlock: true }
  },
  {
    path: '/vault/:id/edit',
    name: 'EditPassword',
    // 编辑密码页：从详情页「更新」进入，复用新增页（AddPasswordView 带 :id 时为编辑模式）。
    // 须先于 /vault/:id 注册，避免「:id/edit」被详情页动态段误匹配
    component: () => import('@/views/add/AddPasswordView.vue'),
    meta: { title: '编辑密码', requiresUnlock: true }
  },
  {
    path: '/vault/:id',
    name: 'PasswordDetail',
    // 密码详情页：从列表点击条目进入，需已解锁
    component: () => import('@/views/detail/PasswordDetailView.vue'),
    meta: { title: '密码详情', requiresUnlock: true }
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

// 访问受保护页面前校验解锁态：未解锁一律回到解锁页
router.beforeEach((to) => {
  if (to.meta?.requiresUnlock && !useAuthStore().isUnlocked) {
    return { name: 'Unlock' }
  }
})

// 计算内层 Tab 滑动方向 + 统一维护页面标题
router.afterEach((to, from) => {
  // 仅两端同为主导航 Tab 页时，按 Tab 前后决定内层左右滑动方向（外壳内层 router-view 读取）。
  // 在 afterEach 同步写入，先于 router-view 的 DOM 更新生效。
  // 其余切换（外壳 ↔ 全屏页 / 详情）由 App.vue 外层固定淡入淡出，无需在此处理。
  const toTab = to.meta?.tab
  const fromTab = from.meta?.tab
  if (toTab && fromTab && toTab !== fromTab) {
    routeTransition.name =
      tabIndexOf(toTab) > tabIndexOf(fromTab) ? 'slide-left' : 'slide-right'
  }

  // 外层过渡：进出「新增 / 编辑密码」走模态卡片滑动（同时进出，取消 out-in），
  // 其余「外壳 ↔ 全屏页 / 详情」保持淡入淡出。
  if (SHEET_ROUTES.has(to.name)) {
    outerTransition.name = 'sheet-up' // 打开：新页自底部滑入
    outerTransition.mode = null
  } else if (SHEET_ROUTES.has(from.name)) {
    outerTransition.name = 'sheet-down' // 关闭：旧页向下滑出
    outerTransition.mode = null
  } else {
    outerTransition.name = 'fade'
    outerTransition.mode = 'out-in'
  }

  const baseTitle = 'SafeVault · 密码安全助手'
  document.title = to.meta?.title ? `${to.meta.title} · SafeVault` : baseTitle
})

export default router
