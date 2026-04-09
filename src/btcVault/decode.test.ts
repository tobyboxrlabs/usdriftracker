import { describe, expect, it } from 'vitest'
import type { BlockscoutV2Log } from '../api/blockscout'
import { decodeBtcVaultEvent } from './decode'

function minimalLog(topics: (string | null)[], decoded: BlockscoutV2Log['decoded'] = null): BlockscoutV2Log {
  return {
    address: { hash: '0x' + '1'.repeat(40) },
    block_number: 1,
    block_timestamp: '2026-01-01T00:00:00.000Z',
    data: '0x',
    decoded,
    topics,
    transaction_hash: '0x' + 'ab'.repeat(32),
    index: 0,
  }
}

describe('decodeBtcVaultEvent', () => {
  it('returns null when topic0 missing', () => {
    expect(decodeBtcVaultEvent(minimalLog([null]))).toBeNull()
  })

  it('returns null for unknown topic', () => {
    expect(decodeBtcVaultEvent(minimalLog(['0xdeadbeef']))).toBeNull()
  })
})
