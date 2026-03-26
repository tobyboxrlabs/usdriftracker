import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockscoutLog } from '../api/blockscout'
import { TRANSFER_EVENT_TOPIC, USDRIF_ADDRESS } from './constants'
import { fetchMintRedeemTransactions } from './fetchMintRedeemTransactions'

vi.mock('../utils/rpc', () => ({
  rpcCall: vi.fn(),
}))

vi.mock('../api/blockscout', () => ({
  fetchLogsV1: vi.fn(),
}))

vi.mock('../utils/logger', () => ({
  logger: {
    mintRedeem: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

import { fetchLogsV1 } from '../api/blockscout'
import { rpcCall } from '../utils/rpc'

const TX_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const RECIPIENT_TOPIC =
  '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ZERO_TOPIC =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

function usdrifMintLog(overrides: Partial<BlockscoutLog> = {}): BlockscoutLog {
  return {
    address: USDRIF_ADDRESS.toLowerCase(),
    topics: [TRANSFER_EVENT_TOPIC, ZERO_TOPIC, RECIPIENT_TOPIC],
    data: '0x0de0b6b3a7640000',
    blockNumber: '0x3e8',
    transactionHash: TX_HASH,
    blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    logIndex: '0x0',
    removed: false,
    ...overrides,
  }
}

describe('fetchMintRedeemTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty recentTxs when Blockscout returns no transfer events', async () => {
    vi.mocked(rpcCall).mockImplementation(async (method: string) => {
      if (method === 'eth_blockNumber') return '0x3e8'
      return null
    })
    vi.mocked(fetchLogsV1).mockResolvedValue([])

    const onProgress = vi.fn()
    const result = await fetchMintRedeemTransactions(1, onProgress)

    expect(result.recentTxs).toEqual([])
    expect(result.currentBlock).toBe(0x3e8)
    expect(result.fromBlock).toBe(0)
    expect(rpcCall).toHaveBeenCalledWith('eth_blockNumber', [])
    expect(fetchLogsV1).toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('returns one USDRIF Mint row when a mint transfer log exists and block/time resolve', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('gettxinfo')) {
          return {
            ok: true,
            json: async () => ({
              status: '1',
              result: {
                from: '0xcccccccccccccccccccccccccccccccccccccccc',
                to: USDRIF_ADDRESS,
                blockNumber: '0x3e8',
                logs: [],
              },
            }),
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
        if (method === 'eth_getTransactionByHash') {
          return {
            from: '0xcccccccccccccccccccccccccccccccccccccccc',
            to: USDRIF_ADDRESS.toLowerCase(),
          }
        }
        return null
      })

      vi.mocked(fetchLogsV1).mockImplementation(
        async (address: string, _from: number, _to: number, topic0: string) => {
          if (address === USDRIF_ADDRESS.toLowerCase() && topic0 === TRANSFER_EVENT_TOPIC) {
            return [usdrifMintLog()]
          }
          return []
        }
      )

      const result = await fetchMintRedeemTransactions(7)

      expect(result.recentTxs.length).toBe(1)
      expect(result.recentTxs[0].type).toBe('USDRIF Mint')
      expect(result.recentTxs[0].hash).toBe(TX_HASH)
      expect(result.recentTxs[0].status).toBe('Success')
      expect(result.currentBlock).toBe(0x3e8)
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })
})
