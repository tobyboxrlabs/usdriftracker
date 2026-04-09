/**
 * Decode Blockscout v2 vault logs into {@link BTCVaultTransaction} rows.
 */
import { ethers } from 'ethers'
import { BTC_VAULT_ABI } from '../config'
import type { BlockscoutV2Log } from '../api/blockscout'
import type { BTCVaultTransaction } from './types'

const TOPICS = {
  DepositRequest: ethers.id('DepositRequest(address,address,uint256,address,uint256)').toLowerCase(),
  NativeDepositRequested: ethers.id('NativeDepositRequested(address,address,uint256,uint256)').toLowerCase(),
  DepositClaimed: ethers.id('DepositClaimed(address,address,address,uint256,uint256,uint256)').toLowerCase(),
  DepositRequestCancelled: ethers.id('DepositRequestCancelled(address,address,uint256,uint256)').toLowerCase(),
  NativeDepositRequestCancelled: ethers.id('NativeDepositRequestCancelled(address,address,uint256,uint256)').toLowerCase(),
  RedeemRequest: ethers.id('RedeemRequest(address,address,uint256,address,uint256)').toLowerCase(),
  RedeemClaimed: ethers.id('RedeemClaimed(address,address,address,uint256,address,uint256,uint256)').toLowerCase(),
  RedeemRequestCancelled: ethers.id('RedeemRequestCancelled(address,address,uint256,uint256)').toLowerCase(),
  SyntheticYieldApplied: ethers.id('SyntheticYieldApplied(uint256,address,uint256)').toLowerCase(),
  MainnetDepositRequested: ethers.id('DepositRequested(address,uint256,uint256,bool)').toLowerCase(),
  MainnetDepositClaimed: ethers.id('DepositClaimed(address,address,uint256,uint256,uint256)').toLowerCase(),
  MainnetDepositRequestCancelled: ethers.id('DepositRequestCancelled(address,uint256,uint256,bool)').toLowerCase(),
} as const

const btcVaultIface = new ethers.Interface(BTC_VAULT_ABI)

function parseBigInt(value: string): string {
  try {
    return BigInt(value).toString()
  } catch {
    return value
  }
}

function normalizeAddr(v: string): string {
  const s = String(v).trim().toLowerCase()
  if (!s || s === '0x') return ''
  return s.startsWith('0x') ? s : `0x${s}`
}

function buildParamMap(log: BlockscoutV2Log): Map<string, string> {
  const m = new Map<string, string>()
  const setIf = (key: string, val: unknown) => {
    if (val === undefined || val === null) return
    const k = key.toLowerCase()
    const s = typeof val === 'bigint' ? val.toString() : String(val).trim()
    if (!s) return
    if (!m.has(k) || m.get(k) === '' || m.get(k) === '0') {
      m.set(k, s)
    }
  }

  if (log.decoded?.parameters) {
    for (const p of log.decoded.parameters) {
      setIf(p.name, p.value)
    }
  }

  const t0 = log.topics[0]
  if (!t0) return m

  try {
    const topics = log.topics.filter((x): x is string => x != null && x.length > 0)
    const parsed = btcVaultIface.parseLog({ topics, data: log.data && log.data !== '' ? log.data : '0x' })
    if (parsed == null) return m
    parsed.fragment.inputs.forEach((inp, i) => {
      if (!inp.name) return
      const v = parsed.args[i]
      setIf(inp.name, v)
    })
  } catch {
    /* Blockscout-only decode */
  }

  return m
}

function pickUint(m: Map<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const raw = m.get(a.toLowerCase())
    if (raw != null && raw !== '') return parseBigInt(raw)
  }
  return '0'
}

function pickAddr(m: Map<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const raw = m.get(a.toLowerCase())
    if (raw == null || raw === '') continue
    const addr = normalizeAddr(raw)
    if (addr && addr !== '0x0000000000000000000000000000000000000000') return addr
  }
  return ''
}

function pickEpoch(m: Map<string, string>): number | undefined {
  const raw = m.get('epochid') ?? m.get('epoch_id')
  if (raw == null || raw === '') return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : undefined
}

export function decodeBtcVaultEvent(log: BlockscoutV2Log): BTCVaultTransaction | null {
  const topic0 = log.topics[0]?.toLowerCase()
  if (!topic0) return null

  const m = buildParamMap(log)

  const base = (status: BTCVaultTransaction['status'], type: BTCVaultTransaction['type']) => {
    const user =
      pickAddr(m, 'user', 'owner', 'account', 'caller', 'sender') || pickAddr(m, 'receiver')
    const receiver = pickAddr(m, 'receiver') || pickAddr(m, 'user', 'owner')
    const amount = pickUint(m, 'amount', 'assets', 'value')
    const shares = pickUint(m, 'shares')
    const token =
      pickAddr(m, 'token') ||
      (topic0 === TOPICS.NativeDepositRequested || topic0 === TOPICS.NativeDepositRequestCancelled
        ? '0x0000000000000000000000000000000000000000'
        : '')
    const assetToken = pickAddr(m, 'assettoken', 'asset_token', 'assetToken') || ''

    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status,
      type,
      user,
      receiver,
      amount,
      shares,
      token,
      assetToken,
      blockNumber: log.block_number,
    }
  }

  if (topic0 === TOPICS.DepositRequest) {
    return { ...base('Requested', 'Deposit Request') }
  }
  if (topic0 === TOPICS.NativeDepositRequested) {
    return { ...base('Requested', 'Deposit Request'), token: '0x0000000000000000000000000000000000000000' }
  }
  if (topic0 === TOPICS.DepositClaimed) {
    return { ...base('Claimed', 'Deposit Claimed'), epochId: pickEpoch(m) }
  }
  if (topic0 === TOPICS.DepositRequestCancelled || topic0 === TOPICS.NativeDepositRequestCancelled) {
    return { ...base('Cancelled', 'Deposit Request') }
  }
  if (topic0 === TOPICS.RedeemRequest) {
    return base('Requested', 'Redeem Request')
  }
  if (topic0 === TOPICS.RedeemClaimed) {
    return { ...base('Claimed', 'Redeem Claimed'), epochId: pickEpoch(m) }
  }
  if (topic0 === TOPICS.RedeemRequestCancelled) {
    return base('Cancelled', 'Redeem Request')
  }
  if (topic0 === TOPICS.SyntheticYieldApplied) {
    const user = pickAddr(m, 'caller', 'user', 'owner', 'account', 'sender')
    const amount = pickUint(m, 'amount', 'assets')
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Claimed',
      type: 'Yield Applied',
      user,
      receiver: '',
      amount,
      shares: '0',
      token: '',
      assetToken: '',
      epochId: pickEpoch(m),
      blockNumber: log.block_number,
    }
  }

  if (topic0 === TOPICS.MainnetDepositRequested) {
    const user = pickAddr(m, 'owner', 'user')
    const amount = pickUint(m, 'assets', 'amount')
    const isNativeRaw = (m.get('isnative') ?? m.get('is_native') ?? '').toLowerCase()
    const isNative = isNativeRaw === 'true' || isNativeRaw === '1'
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Requested',
      type: 'Deposit Request',
      user,
      receiver: '',
      amount,
      shares: '0',
      token: isNative ? '0x0000000000000000000000000000000000000000' : '',
      assetToken: '',
      epochId: pickEpoch(m),
      blockNumber: log.block_number,
    }
  }
  if (topic0 === TOPICS.MainnetDepositClaimed) {
    const user = pickAddr(m, 'caller', 'user', 'owner')
    const receiver = pickAddr(m, 'receiver')
    const amount = pickUint(m, 'assets', 'amount')
    const shares = pickUint(m, 'shares')
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Claimed',
      type: 'Deposit Claimed',
      user,
      receiver,
      amount,
      shares,
      token: '',
      assetToken: '',
      epochId: pickEpoch(m),
      blockNumber: log.block_number,
    }
  }
  if (topic0 === TOPICS.MainnetDepositRequestCancelled) {
    const user = pickAddr(m, 'owner', 'user')
    const amount = pickUint(m, 'assets', 'amount')
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Cancelled',
      type: 'Deposit Request',
      user,
      receiver: '',
      amount,
      shares: '0',
      token: '',
      assetToken: '',
      epochId: pickEpoch(m),
      blockNumber: log.block_number,
    }
  }
  return null
}
