import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockscoutLog } from './blockscout'
import { fetchLogsV1, fetchLogsV2, type BlockscoutV2Log } from './blockscout'

vi.mock('../utils/logger', () => ({
  logger: {
    blockscout: {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
  },
}))

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  } as Response
}

describe('fetchLogsV1', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects invalid fromBlock', async () => {
    await expect(fetchLogsV1('0xa', -1, 100, '0xt')).rejects.toThrow(/fromBlock/)
  })

  it('rejects when toBlock < fromBlock', async () => {
    await expect(fetchLogsV1('0xa', 50, 40, '0xt')).rejects.toThrow(/toBlock/)
  })

  it('returns logs when API status is 1', async () => {
    const log: BlockscoutLog = {
      address: '0xa',
      topics: ['0xt'],
      data: '0x',
      blockNumber: '0x64',
      transactionHash: '0xtx',
      blockHash: '0xb',
      logIndex: '0x0',
      removed: false,
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ status: '1', result: [log] }))

    const out = await fetchLogsV1('0xa', 0, 100, '0xt')
    expect(out).toEqual([log])
    expect(fetch).toHaveBeenCalledTimes(1)
    const url = String(vi.mocked(fetch).mock.calls[0][0])
    expect(url).toContain('module=logs')
    expect(url).toContain('action=getLogs')
  })

  it('returns empty array when API reports no logs', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ status: '0', message: 'No logs found', result: [] })
    )
    await expect(fetchLogsV1('0xa', 0, 10, '0xt')).resolves.toEqual([])
  })

  it('throws when API status is 0 with unexpected message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ status: '0', message: 'Internal error', result: [] })
    )
    await expect(fetchLogsV1('0xa', 0, 10, '0xt')).rejects.toThrow(/Blockscout API returned an error/)
  })

  it('throws on non-JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'not json',
    } as Response)
    await expect(fetchLogsV1('0xa', 0, 10, '0xt')).rejects.toThrow(/non-JSON/)
  })
})

describe('fetchLogsV2', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function v2Item(overrides: Partial<BlockscoutV2Log>): BlockscoutV2Log {
    return {
      address: { hash: '0xvault' },
      block_number: 1000,
      block_timestamp: new Date().toISOString(),
      data: '0x',
      decoded: null,
      topics: [],
      transaction_hash: '0xtx',
      index: 0,
      ...overrides,
    }
  }

  it('filters items to fromBlock–toBlock inclusive', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        items: [v2Item({ block_number: 50 }), v2Item({ block_number: 150 }), v2Item({ block_number: 900 })],
        next_page_params: null,
      })
    )

    const logs = await fetchLogsV2('https://explorer.test/api/v2', '0xvault', 100, 200)
    expect(logs.length).toBe(1)
    expect(logs[0].block_number).toBe(150)
  })

  it('returns empty when first page has no items', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ items: [], next_page_params: null }))
    const logs = await fetchLogsV2('https://explorer.test/api/v2', '0xvault', 0, 1_000_000)
    expect(logs).toEqual([])
  })

  it('throws on non-OK HTTP', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{}',
    } as Response)
    await expect(
      fetchLogsV2('https://explorer.test/api/v2', '0xvault', 0, 100)
    ).rejects.toThrow(/API v2 error/)
  })
})
