import { describe, it, expect } from 'vitest'
import { calcHandRolledUsdrifMintable, MOC_PRECISION } from './calcUsdrifMintable'

describe('calcHandRolledUsdrifMintable', () => {
  it('returns 0 when lckACemaAdjusted is non-positive', () => {
    const ctarg = 10n * MOC_PRECISION
    const lck = 100n * MOC_PRECISION
    const nACcb = 50n * MOC_PRECISION
    expect(calcHandRolledUsdrifMintable(nACcb, ctarg, lck, ctarg, MOC_PRECISION)).toBe(0n)
  })

  it('computes mintable from protocol inputs', () => {
    const nACcb = 308_424_328n * MOC_PRECISION
    const ctargemaCA = 997n * 10n ** 16n
    const lckAC = 26_306_018n * MOC_PRECISION
    const ctargemaTP = 997n * 10n ** 16n
    const pACtp = 86_711n * 10n ** 12n
    const result = calcHandRolledUsdrifMintable(nACcb, ctargemaCA, lckAC, ctargemaTP, pACtp)
    expect(result).toBeGreaterThan(400_000n * MOC_PRECISION)
  })
})
