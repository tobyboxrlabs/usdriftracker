import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTokenData } from './useTokenData'

const testCtx = vi.hoisted(() => {
  const mockContract = {
    name: vi.fn().mockResolvedValue('USDRIF Token'),
    symbol: vi.fn().mockResolvedValue('USDRIF'),
    decimals: vi.fn().mockResolvedValue(18),
    totalSupply: vi.fn().mockResolvedValue(1000n * 10n ** 18n),
    read: vi.fn().mockResolvedValue(41n * 10n ** 16n),
    getTotalACavailable: vi.fn().mockResolvedValue(212n * 10n ** 24n),
    calcCtargemaCA: vi.fn().mockResolvedValue(55n * 10n ** 17n),
  }
  return {
    rpcFail: false,
    mockContract,
  }
})

vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: class {
      getBlockNumber() {
        if (testCtx.rpcFail) return Promise.reject(new Error('Failed to fetch'))
        return Promise.resolve(1)
      }
    },
    Contract: vi.fn(() => testCtx.mockContract),
    getAddress: vi.fn((address: string) => address),
  },
}))

vi.mock('../history', () => ({
  METRIC_KEYS: {
    ST_RIF_SUPPLY: 'stRIFSupply',
    VAULTED_USDRIF: 'vaultedUsdrif',
    RIFPRO_SUPPLY: 'rifproSupply',
    MINTED: 'minted',
    RIF_PRICE: 'rifPrice',
    RIF_COLLATERAL: 'rifCollateral',
    MAX_MINTABLE: 'maxMintable',
  },
  saveMetricHistory: vi.fn(),
  getMetricHistory: vi.fn(() => []),
}))

vi.mock('../config', async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import('../config')
  return {
    ...mod,
    CONFIG: {
      ...mod.CONFIG,
      REFRESH_INTERVAL: 3600_000,
    },
  }
})

vi.mock('../utils/logger', () => ({
  logger: {
    tokenData: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    rpc: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}))

describe('useTokenData', () => {
  beforeEach(() => {
    testCtx.rpcFail = false
    vi.clearAllMocks()
  })

  afterEach(() => {
    testCtx.rpcFail = false
  })

  it('loads token metrics and clears loading', async () => {
    const { result } = renderHook(() => useTokenData())

    await waitFor(
      () => {
        expect(result.current.tokenData.loading).toBe(false)
      },
      { timeout: 15_000 }
    )

    expect(result.current.tokenData.error).toBeNull()
    expect(result.current.tokenData.formattedStRIFSupply).toBe('1000')
    expect(result.current.tokenData.formattedMinted).toBe('1000')
    expect(result.current.tokenData.lastUpdated).toBeInstanceOf(Date)
    expect(result.current.isClientOutdated).toBe(false)
  })

  it('sets user-facing error when no RPC endpoint works', async () => {
    testCtx.rpcFail = true

    const { result } = renderHook(() => useTokenData())

    await waitFor(
      () => {
        expect(result.current.tokenData.loading).toBe(false)
      },
      { timeout: 15_000 }
    )

    expect(result.current.tokenData.error).not.toBeNull()
    expect(result.current.tokenData.error).toMatch(/network|connection|RSK|endpoint|Unable to connect/i)
  })
})
