/**
 * FE-KDF 客户端密钥派生单测（以 utils/kdf.js 实际代码行为为基线）。
 *
 * deriveVerifier(password) → { verifier(base64), kdfParams{ algorithm, salt, iterations, length } }
 * deriveVerifierWithParams(password, kdfParams) → verifier(base64)，用注册时配方重算。
 *
 * 注意（待澄清项 DEF-KDF-ITER）：kdf.js 实际生效迭代为 60000，但文件注释多处写 600000/「60 万」；
 * 且 safevault_ui/src/utils/kdf.js 默认迭代为 600000。本组用例只断言「确定性 + 结构 + 回放一致」，
 * 不把 iterations 具体值写死为某个数（避免与待澄清项耦合），仅校验同一端自洽。
 *
 * 运行环境：Node 18+ 全局 WebCrypto；kdf 依赖的 webcrypto 句柄在非 App 环境回落 globalThis.crypto。
 */
import { describe, it, expect } from 'vitest'
import { deriveVerifier, deriveVerifierWithParams } from '@/utils/kdf'

describe('deriveVerifier', () => {
  it('FE-KDF-01 产出结构完整：verifier(base64) + kdfParams 四字段', async () => {
    const { verifier, kdfParams } = await deriveVerifier('MyMaster@2025')
    expect(typeof verifier).toBe('string')
    expect(verifier.length).toBeGreaterThanOrEqual(16) // 后端列校验 16~1024
    expect(kdfParams).toMatchObject({
      algorithm: 'PBKDF2-SHA256',
      salt: expect.any(String),
      iterations: expect.any(Number),
      length: 32,
    })
  })

  it('FE-KDF-02 每次派生 salt 随机 → verifier 不同（同密码两次不同 salt）', async () => {
    const a = await deriveVerifier('SamePass@1')
    const b = await deriveVerifier('SamePass@1')
    expect(a.kdfParams.salt).not.toBe(b.kdfParams.salt)
    expect(a.verifier).not.toBe(b.verifier)
  })

  it('FE-KDF-03 回放一致：用注册产出的 kdfParams 同密码重算得同 verifier', async () => {
    const { verifier, kdfParams } = await deriveVerifier('Replay@2025')
    const again = await deriveVerifierWithParams('Replay@2025', kdfParams)
    expect(again).toBe(verifier)
  })

  it('FE-KDF-04 不同密码 + 同 kdfParams → verifier 不同', async () => {
    const { kdfParams } = await deriveVerifier('PassOne@1')
    const v1 = await deriveVerifierWithParams('PassOne@1', kdfParams)
    const v2 = await deriveVerifierWithParams('PassTwo@2', kdfParams)
    expect(v1).not.toBe(v2)
  })
})

describe('deriveVerifierWithParams - 异常配方', () => {
  it('FE-KDF-05 算法不匹配 → 抛「不支持的密钥派生配方」', async () => {
    await expect(
      deriveVerifierWithParams('x', { algorithm: 'argon2id', salt: 'AAAA', iterations: 3, length: 32 }),
    ).rejects.toThrow('不支持的密钥派生配方')
  })

  it('FE-KDF-06 kdfParams 缺失 → 抛错', async () => {
    await expect(deriveVerifierWithParams('x', null)).rejects.toThrow()
  })
})
