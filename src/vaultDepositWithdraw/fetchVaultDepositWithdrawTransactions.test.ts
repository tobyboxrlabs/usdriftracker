import { ethers } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockscoutV2Log } from '../api/blockscout'
import { VAULT_ABI, VAULT_ADDRESS } from './constants'
import { fetchVaultDepositWithdrawTransactions } from './fetchVaultDepositWithdrawTransactions'

vi.mock('../utils/rpc', () => ({
  rpcCall: vi.fn(),
}))

vi.mock('../api/blockscout', () => ({
  fetchLogsV2: vi.fn(),
}))

vi.mock('../utils/logger', () => ({
  logger: {
    vault: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

import { fetchLogsV2 } from '../api/blockscout'
import { rpcCall } from '../utils/rpc'

const vaultInterface = new ethers.Interface(VAULT_ABI)
const depositTopic = vaultInterface.getEvent('Deposit')!.topicHash

const TX_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function sampleDepositLog(overrides: Partial<BlockscoutV2Log> = {}): BlockscoutV2Log {
  return {
    address: { hash: VAULT_ADDRESS },
    block_number: 0x3e8,
    block_timestamp: new Date().toISOString(),
    data: '0x',
    decoded: {
      method_call: 'Deposit',
      parameters: [
        { name: 'sender', type: 'address', value: '0xcccccccccccccccccccccccccccccccccccccccc' },
        { name: 'owner', type: 'address', value: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        { name: 'assets', type: 'uint256', value: '1000000000000000000' },
        { name: 'shares', type: 'uint256', value: '1000000000000000000' },
      ],
    },
    topics: [depositTopic, '0xpad1', '0xpad2'],
    transaction_hash: TX_HASH,
    index: 0,
    ...overrides,
  }
}

describe('fetchVaultDepositWithdrawTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty recentTxs when Blockscout returns no vault events', async () => {
    vi.mocked(rpcCall).mockImplementation(async (method: string) => {
      if (method === 'eth_blockNumber') return '0x3e8'
      return null
    })
    vi.mocked(fetchLogsV2).mockResolvedValue([])

    const onProgress = vi.fn()
    const result = await fetchVaultDepositWithdrawTransactions(1, onProgress)

    expect(result.recentTxs).toEqual([])
    expect(result.currentBlock).toBe(0x3e8)
    expect(result.fromBlock).toBe(0)
    expect(rpcCall).toHaveBeenCalledWith('eth_blockNumber', [])
    expect(fetchLogsV2).toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalled()
  })

  it('returns one Deposit row when a matching v2 log and block time resolve', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('gettxinfo')) {
          return {
            ok: true,
            json: async () => ({ status: '1', result: { success: true } }),
          } as Response
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response
      }
    )

    try {
      vi.mocked(rpcCall).mockImplementation(async (method: string, params?: unknown[]) => {
        if (method === 'eth_blockNumber') return '0x3e8'
        if (method === 'eth_getBlockByNumber') {
          const nowSec = Math.floor(Date.now() / 1000)
          return { timestamp: '0x' + nowSec.toString(16) }
        }
        return null
      })

      vi.mocked(fetchLogsV2).mockResolvedValue([sampleDepositLog()])

      const result = await fetchVaultDepositWithdrawTransactions(7)

      expect(result.recentTxs.length).toBe(1)
      expect(result.recentTxs[0].type).toBe('Deposit')
      expect(result.recentTxs[0].hash).toBe(TX_HASH)
      expect(result.recentTxs[0].status).toBe('Success')
      expect(result.recentTxs[0].receiver).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
      expect(result.currentBlock).toBe(0x3e8)
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })
})
