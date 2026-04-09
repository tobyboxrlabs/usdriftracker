import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchBtcVaultTransactions } from './fetchBtcVaultTransactions'

vi.mock('../utils/rpc', () => ({
  rpcCall: vi.fn(() => Promise.resolve('0x3e8')),
}))

vi.mock('../api/blockscout', () => ({
  fetchLogsV2: vi.fn(() => Promise.resolve([])),
}))

vi.mock('./price', () => ({
  fetchRbtcUsdPrice: vi.fn(() => Promise.resolve(95_000)),
}))

describe('fetchBtcVaultTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sorted empty txs and price when no logs', async () => {
    const { recentTxs, rbtcUsd } = await fetchBtcVaultTransactions({ chain: 'testnet', days: 1 })
    expect(recentTxs).toEqual([])
    expect(rbtcUsd).toBe(95_000)
  })
})
