/**
 * STR 执行阶段专用 Vitest 配置（不修改业务代码、不污染既有构建脚本）。
 *
 * - 仅纳入 tests-str/ 下的单测，覆盖 utils 纯函数与 kdf 派生。
 * - 配置 `@` 别名指向工程根（与 jsconfig.json paths `@/*: ./*` 一致），使被测源码内的
 *   `import ... from '@/utils/cryptoPolyfill'` 等能在 Node 环境解析。
 * - environment 用默认 node：Node 18+ 自带全局 WebCrypto，kdf.js 的 webcrypto 句柄在非 App 环境
 *   回落到 globalThis.crypto，可直接派生，无需浏览器环境。
 */
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: [
      // UTS 原生插件在 Node/H5 不存在，桩成「不可用」以触发业务自有的 noble 回落（须先于通配 @ 规则）
      {
        find: '@/uni_modules/safevault-pbkdf2',
        replacement: fileURLToPath(new URL('./tests-str/__stubs__/uts-pbkdf2.mjs', import.meta.url)),
      },
      { find: /^@\/(.*)/, replacement: fileURLToPath(new URL('./', import.meta.url)) + '$1' },
    ],
  },
  test: {
    include: ['tests-str/**/*.test.mjs'],
    environment: 'node',
  },
})
