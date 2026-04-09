import { describe, expect, it } from 'vitest'
import { needsDistinctReceiverColumn } from './helpers'
import type { BTCVaultTransaction } from './types'

const row = (partial: Partial<BTCVaultTransaction>): BTCVaultTransaction => ({
  time: new Date(),
  hash: '0xh',
  status: 'Requested',
  type: 'Deposit Request',
  user: '',
  receiver: '',
  amount: '0',
  shares: '0',
  token: '',
  assetToken: '',
  blockNumber: 1,
  ...partial,
})

describe('needsDistinctReceiverColumn', () => {
  it('is false when receiver empty for all rows', () => {
    expect(needsDistinctReceiverColumn([row({ user: '0x1', receiver: '' })])).toBe(false)
  })

  it('is false when user and receiver match', () => {
    const a = '0xAbCdeFabcdefABCDEFabcdefabcdefabcdefabcd'
    expect(needsDistinctReceiverColumn([row({ user: a, receiver: a.toLowerCase() })])).toBe(false)
  })

  it('is true when receiver set and user differs', () => {
    expect(
      needsDistinctReceiverColumn([
        row({ user: '0x1111111111111111111111111111111111111111', receiver: '0x2222222222222222222222222222222222222222' }),
      ])
    ).toBe(true)
  })

  it('is true when receiver set and user empty', () => {
    expect(needsDistinctReceiverColumn([row({ user: '', receiver: '0x3333333333333333333333333333333333333333' })])).toBe(true)
  })
})
