import { createRouter, createWebHistory } from 'vue-router'
import { useCloudAccountStore } from '@/stores/cloudAccount'
import { tabIndexOf } from '@/constants/tabs'
import { routeTransition, outerTransition } from '@/router/transition'

// 走「自右侧弹出」式滑动的页面（详情 / 新增 / 编辑 / 修改账户密码 / 回收站，
// 以及登录流程的「账户密码登录 / 创建云账户 / 重置密码」三页）。
// 这些页面由点击进入时自右侧滑入、离开 / 返回时向右滑回（退回进来的右侧）。
const SHEET_ROUTES = new Set([
  'PasswordDetail',
  'AddPassword',
  'EditPassword',
  'ChangeMasterPassword',
  'RegenerateRecovery',
  'Trash',
  'CategoryManage',
  // 登录流程：从登录首页（Unlock）自右侧弹出 / 收回
  'MasterPassword', // 账户密码登录
  'Onboarding', // 创建云账户（注册）
  'ResetPassword' // 忘记密码·重置
])

/**
 * 路由表
 * 解锁页为应用入口；其余业务页面采用懒加载，按需分包。
 */
const routes = [
  {
    path: '/onboarding',
    name: 'Onboarding',
    // 新用户开户流程（创建云账户：邮箱 + 密码 + 验证码）：由登录页「新用户注册」入口进入，无需 requiresUnlock
    component: () => import('@/views/onboarding/OnboardingView.vue'),
    meta: { title: '创建云账户', fullscreen: true }
  },
  {
    path: '/unlock',
    name: 'Unlock',
    // 登录页是首屏入口，直接静态引入以保证首屏速度
    component: () => import('@/views/unlock/UnlockView.vue'),
    meta: { title: '登录 SafeVault', fullscreen: true }
  },
  {
    path: '/unlock/master',
    name: 'MasterPassword',
    // 账户密码登录页：属于登录流程内的子页面，无需 requiresUnlock 守卫
    component: () => import('@/views/unlock/PasswordView.vue'),
    meta: { title: '账户密码登录', fullscreen: true }
  },
  {
    path: '/recovery',
    name: 'ResetPassword',
    // 忘记密码：邮箱验证码重置账户密码。用户被锁在外面时进入，无需 requiresUnlock
    component: () => import('@/views/recovery/ResetPasswordView.vue'),
    meta: { title: '重置密码', fullscreen: true }
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
    // 修改账户密码：从设置「安全 → 修改账户密码」进入，需已登录。
    // 同页完成「验证当前密码 + 设置新密码」，依「修改密码需先验证旧凭证」。
    component: () => import('@/views/change-password/ChangePasswordView.vue'),
    meta: { title: '修改账户密码', requiresUnlock: true }
  },
  {
    path: '/settings/recovery-code',
    name: 'RegenerateRecovery',
    // 重新生成恢复码：从设置「安全 → 恢复码」进入，需已登录（身份验证已在设置页前置完成）。
    // 进入即用会话 DataKey 以新恢复码重新包裹上传 recovery-blob，旧码失效后展示新码供保存。
    component: () => import('@/views/recovery/RegenerateRecoveryView.vue'),
    meta: { title: '重新生成恢复码', requiresUnlock: true }
  },
  {
    path: '/settings/trash',
    name: 'Trash',
    // 回收站：从设置「数据 → 回收站」进入，需已解锁。承载软删除条目，可恢复 / 彻底删除 / 清空。
    component: () => import('@/views/trash/TrashView.vue'),
    meta: { title: '回收站', requiresUnlock: true }
  },
  {
    path: '/vault/categories',
    name: 'CategoryManage',
    // 分类管理页：从设置「数据 → 分类管理」进入，需已解锁。管理密码库分类（改名/删除/排序/新建）。
    // 必须先于 /vault/:id 注册，否则 categories 会被动态段当作 id 匹配
    component: () => import('@/views/categories/CategoryManageView.vue'),
    meta: { title: '分类管理', requiresUnlock: true }
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

// 路由前置守卫：登录态校验 + 重复注册防护（登录页为统一首屏入口）
router.beforeEach((to) => {
  const auth = useCloudAccountStore()

  // 1) 已注册却访问创建账户页：默认重定向回登录页，避免误入重复创建；
  //    但登录页「新用户注册」入口显式带 ?register=1，放行其有意创建新账户（覆盖旧绑定）。
  if (auth.hasAccount && to.name === 'Onboarding' && to.query.register !== '1') {
    return { name: 'Unlock' }
  }

  // 2) 受保护页面校验登录态：未登录一律回到登录页。
  //    启动不再强制跳开户页——登录页（Unlock）即首屏，由用户自行选择登录 / 新开户 / 忘记密码。
  if (to.meta?.requiresUnlock && !auth.loggedIn) {
    return { name: 'Unlock' }
  }
})

// 记录上一次的历史位置，用于在 afterEach 中判别「前进 / 后退」（Vue Router 在
// history.state.position 维护单调递增的位置序号：push 递增、back 递减、replace 不变）。
let lastHistoryPosition = window.history.state?.position ?? 0

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

  // 外层过渡：右侧弹出页「进入自右滑入 / 退出向右滑回」（同时进出，取消 out-in），其余淡入淡出。
  // 因详情 / 编辑等互为弹出页，单看「目标是否弹出页」无法区分开/关，需结合前进后退方向：
  //   - 前进进入弹出页（toSheet 且非后退）：sheet-right 自右滑入；
  //   - 后退离开弹出页 / 前进关闭弹出页回到底层：sheet-close 向右滑回（呼应左滑反向收回手势）。
  const position = window.history.state?.position ?? 0
  const isBack = position < lastHistoryPosition
  lastHistoryPosition = position
  const toSheet = SHEET_ROUTES.has(to.name)
  const fromSheet = SHEET_ROUTES.has(from.name)

  if (toSheet && !isBack) {
    outerTransition.name = 'sheet-right' // 打开：新页自右侧滑入
    outerTransition.mode = null
  } else if (fromSheet && (isBack || !toSheet)) {
    outerTransition.name = 'sheet-close' // 关闭：旧页向右滑回（退回进来的右侧）
    outerTransition.mode = null
  } else {
    outerTransition.name = 'fade'
    outerTransition.mode = 'out-in'
  }

  const baseTitle = 'SafeVault · 密码安全助手'
  document.title = to.meta?.title ? `${to.meta.title} · SafeVault` : baseTitle
})

export default router
