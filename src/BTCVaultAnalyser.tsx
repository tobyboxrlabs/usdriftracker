import { useState, useCallback, useEffect, useMemo } from 'react'
import { ethers } from 'ethers'
import { BTC_VAULT_ABI, CONFIG } from './config'
import { AddressLinkWithRns } from './components/AddressLinkWithRns'
import { useRnsReverseLookup } from './hooks/useRnsReverseLookup'
import * as XLSX from 'xlsx'
import { fetchLogsV2, type BlockscoutV2Log } from './api/blockscout'
import { rpcCall } from './utils/rpc'
import { userFacingError } from './utils/userFacingError'
import { AnalyserShell } from './components/AnalyserShell'
import { formatAmount, formatAmountDisplay } from './utils/amount'
import { generateTimestampFilename, writeExcelWorkbook } from './utils/exportExcel'
import './MintRedeemAnalyser.css'

/** Which Rootstock network this analyser uses (shared UI + decode logic). */
export type BTCVaultChain = 'testnet' | 'mainnet'

const BTC_VAULT_CHAIN = {
  testnet: {
    blockscoutV2Api: CONFIG.RSK_TESTNET_BLOCKSCOUT_V2,
    vaultAddressLower: CONFIG.BTC_VAULT_RBTC_ASYNC_VAULT_PROXY.toLowerCase(),
    rpcUrl: CONFIG.RSK_TESTNET_RPC,
    explorerOrigin: 'https://rootstock-testnet.blockscout.com',
    excelBaseName: 'btc-vault-testnet-transactions',
    excelSheet: 'BTC Vault (testnet)',
  },
  mainnet: {
    blockscoutV2Api: CONFIG.RSK_MAINNET_BLOCKSCOUT_V2,
    vaultAddressLower: CONFIG.BTC_VAULT_MAINNET_ROOTSTOCK_VAULT_PROXY.toLowerCase(),
    rpcUrl: CONFIG.ROOTSTOCK_RPC,
    explorerOrigin: 'https://rootstock.blockscout.com',
    excelBaseName: 'btc-vault-mainnet-transactions',
    excelSheet: 'BTC Vault (mainnet)',
  },
} as const satisfies Record<
  BTCVaultChain,
  {
    blockscoutV2Api: string
    vaultAddressLower: string
    rpcUrl: string
    explorerOrigin: string
    excelBaseName: string
    excelSheet: string
  }
>

interface BTCVaultTransaction {
  time: Date
  hash: string
  status: 'Requested' | 'Claimed' | 'Cancelled'
  type: 'Deposit Request' | 'Deposit Claimed' | 'Redeem Request' | 'Redeem Claimed' | 'Yield Applied'
  user: string
  receiver: string
  amount: string
  shares: string
  token: string
  assetToken: string
  epochId?: number
  blockNumber: number
}

const BLOCKS_PER_DAY = 2880
const COINGECKO_RBTC_ID = 'rootstock-smart-bitcoin'
const COINGECKO_BTC_FALLBACK_ID = 'bitcoin'
const COINGECKO_PRICE_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_RBTC_ID},${COINGECKO_BTC_FALLBACK_ID}&vs_currencies=usd`

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
  /** Rootstock mainnet RootstockBTCVault (epoch-based; different from testnet async vault) */
  MainnetDepositRequested: ethers.id('DepositRequested(address,uint256,uint256,bool)').toLowerCase(),
  MainnetDepositClaimed: ethers.id('DepositClaimed(address,address,uint256,uint256,uint256)').toLowerCase(),
  MainnetDepositRequestCancelled: ethers.id('DepositRequestCancelled(address,uint256,uint256,bool)').toLowerCase(),
}

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

/**
 * Merge Blockscout `decoded.parameters` with `ethers.Interface.parseLog` so names like
 * `assets` vs `amount` and indexed fields are filled when the explorer shape drifts.
 */
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

function decodeEvent(log: BlockscoutV2Log): BTCVaultTransaction | null {
  const topic0 = log.topics[0]?.toLowerCase()
  if (!topic0) return null

  const m = buildParamMap(log)

  const base = (status: BTCVaultTransaction['status'], type: BTCVaultTransaction['type']) => {
    const user =
      pickAddr(m, 'user', 'owner', 'account', 'caller', 'sender') ||
      pickAddr(m, 'receiver')
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Show Receiver only when some row has a receiver distinct from user (or user missing but receiver set). */
function needsDistinctReceiverColumn(transactions: BTCVaultTransaction[]): boolean {
  return transactions.some((tx) => {
    const u = tx.user?.trim().toLowerCase() || ''
    const r = tx.receiver?.trim().toLowerCase() || ''
    if (!r) return false
    return !u || u !== r
  })
}

async function fetchRbtcUsdPrice(): Promise<number | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(COINGECKO_PRICE_URL, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) return null
    const data = (await res.json()) as { [key: string]: { usd?: number } }
    const rbtc = data[COINGECKO_RBTC_ID]?.usd
    const btc = data[COINGECKO_BTC_FALLBACK_ID]?.usd
    const price = typeof rbtc === 'number' && rbtc > 0 ? rbtc : typeof btc === 'number' && btc > 0 ? btc : null
    return price
  } catch {
    return null
  }
}

interface BTCVaultAnalyserProps {
  /** Defaults to testnet for backward compatibility. */
  chain?: BTCVaultChain
  initialExpanded?: boolean
  initialDays?: number
}

export default function BTCVaultAnalyser({
  chain = 'testnet',
  initialExpanded,
  initialDays,
}: BTCVaultAnalyserProps = {}) {
  const net = BTC_VAULT_CHAIN[chain]
  const rnsRegistry = chain === 'mainnet' ? CONFIG.RNS_REGISTRY_MAINNET : CONFIG.RNS_REGISTRY_TESTNET

  const [transactions, setTransactions] = useState<BTCVaultTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(initialDays ?? 7)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(!(initialExpanded ?? false))
  const [rbtcUsd, setRbtcUsd] = useState<number | null>(null)

  const addressesForRns = useMemo(() => {
    const s = new Set<string>()
    for (const tx of transactions) {
      if (tx.user) s.add(tx.user)
      if (tx.receiver) s.add(tx.receiver)
    }
    return [...s]
  }, [transactions])
  const bensChainId = chain === 'mainnet' ? CONFIG.ROOTSTOCK_MAINNET_CHAIN_ID : CONFIG.ROOTSTOCK_TESTNET_CHAIN_ID
  const rnsLabels = useRnsReverseLookup(addressesForRns, bensChainId, net.rpcUrl, rnsRegistry, !isCollapsed)

  const showReceiverColumn = useMemo(() => needsDistinctReceiverColumn(transactions), [transactions])

  const loadPrice = useCallback(async () => {
    const price = await fetchRbtcUsdPrice()
    setRbtcUsd(price)
  }, [])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const blockNumberHex = await rpcCall<string>('eth_blockNumber', [], net.rpcUrl)
      const currentBlock = parseInt(blockNumberHex ?? '0x0', 16)

      const blockRange = BLOCKS_PER_DAY * days
      const fromBlock = Math.max(0, currentBlock - blockRange)

      const logs = await fetchLogsV2(net.blockscoutV2Api, net.vaultAddressLower, fromBlock, currentBlock)
      const decoded = logs
        .map(decodeEvent)
        .filter((t): t is BTCVaultTransaction => t !== null)
      decoded.sort((a, b) => b.time.getTime() - a.time.getTime())
      setTransactions(decoded)
      setLastUpdated(new Date())
      const price = await fetchRbtcUsdPrice()
      setRbtcUsd(price)
    } catch (err) {
      setError(userFacingError(err))
    } finally {
      setLoading(false)
    }
  }, [days, net.blockscoutV2Api, net.rpcUrl, net.vaultAddressLower])

  useEffect(() => {
    if (!isCollapsed) {
      loadPrice()
      fetchTransactions()
    }
  }, [isCollapsed, loadPrice, fetchTransactions])

  const exportToExcel = useCallback(() => {
    if (transactions.length === 0) {
      alert('No transactions to export')
      return
    }
    const rbtcAmounts = transactions.map((tx) => parseFloat(formatAmount(BigInt(tx.amount), 18)))
    const rows = transactions.map((tx, i) => {
      const amountRbtc = formatAmountDisplay(formatAmount(BigInt(tx.amount), 18), 8)
      const usdEquiv = rbtcUsd != null ? rbtcAmounts[i] * rbtcUsd : null
      const row: Record<string, string | number> = {
        'Timestamp': tx.time.toISOString(),
        'Tx Hash': tx.hash,
        'Type': tx.type,
        'Status': tx.status,
        'Amount (RBTC)': amountRbtc,
        'Shares': formatAmountDisplay(formatAmount(BigInt(tx.shares), 18), 8),
        'USD Equiv.': usdEquiv != null ? formatUsd(usdEquiv) : '',
        'User': tx.user,
        'Epoch ID': tx.epochId ?? '',
        'Block': tx.blockNumber,
      }
      if (showReceiverColumn) row['Receiver'] = tx.receiver
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, net.excelSheet)
    const filename = generateTimestampFilename(net.excelBaseName)
    writeExcelWorkbook(wb, filename)
  }, [transactions, rbtcUsd, net.excelBaseName, net.excelSheet, showReceiverColumn])

  const controls = (
    <>
      <div className="filter-toggle" />
      <div className="right-controls">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <button onClick={fetchTransactions} disabled={loading} aria-busy={loading}>
          {loading && <span className="refresh-spinner" />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button className="export-button" onClick={exportToExcel} disabled={loading}>
          XLS
        </button>
      </div>
    </>
  )

  return (
    <AnalyserShell
      title="BTC Vault"
      networkBadge={chain === 'mainnet' ? 'mainnet' : 'testnet'}
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      controls={controls}
      error={error}
      loading={loading}
      isEmpty={transactions.length === 0}
      emptyMessage="No BTC Vault transactions found in the selected period."
    >
      <div className="transactions-table-container btc-vault-table">
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Amount (RBTC)</th>
                    <th>Shares</th>
                    <th>USD Equiv.</th>
                    <th>User</th>
                    <th className={showReceiverColumn ? undefined : 'btc-vault-receiver-col-hidden'}>Receiver</th>
                    <th>Epoch</th>
                    <th>Block</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, idx) => {
                    const amountHuman = formatAmount(BigInt(tx.amount), 18)
                    const amountDisplay = formatAmountDisplay(amountHuman, 8)
                    const sharesHuman = formatAmount(BigInt(tx.shares), 18)
                    const sharesDisplay = formatAmountDisplay(sharesHuman, 8)
                    const usdProduct =
                      rbtcUsd != null ? parseFloat(amountHuman) * rbtcUsd : Number.NaN
                    const usdDisplay =
                      rbtcUsd != null && Number.isFinite(usdProduct)
                        ? formatUsd(usdProduct)
                        : '—'

                    return (
                    <tr key={`${tx.hash}-${idx}`}>
                      <td className="hash-cell">
                        <a href={`${net.explorerOrigin}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" title={tx.hash}>
                          {tx.time.toISOString().replace('T', ' ').substring(0, 19)}
                        </a>
                      </td>
                      <td>{tx.status}</td>
                      <td className={tx.type.includes('Deposit') ? 'type-mint' : tx.type.includes('Redeem') ? 'type-redeem' : ''}>
                        {tx.type}
                      </td>
                      <td title={amountDisplay}>
                        {amountDisplay}
                      </td>
                      <td title={sharesDisplay}>
                        {sharesDisplay}
                      </td>
                      <td title={usdDisplay !== '—' ? usdDisplay : undefined}>
                        {usdDisplay}
                      </td>
                      <td className="address-cell">
                        {tx.user ? (
                          <AddressLinkWithRns
                            href={`${net.explorerOrigin}/address/${tx.user}`}
                            address={tx.user}
                            rnsByAddressLower={rnsLabels}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className={`address-cell${showReceiverColumn ? '' : ' btc-vault-receiver-col-hidden'}`}
                      >
                        {tx.receiver ? (
                          <AddressLinkWithRns
                            href={`${net.explorerOrigin}/address/${tx.receiver}`}
                            address={tx.receiver}
                            rnsByAddressLower={rnsLabels}
                            shortenIfNoRns
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{tx.epochId ?? '—'}</td>
                      <td>
                        <a href={`${net.explorerOrigin}/block/${tx.blockNumber}`} target="_blank" rel="noopener noreferrer">
                          {tx.blockNumber}
                        </a>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              {lastUpdated && (
                <div className="transactions-summary">
                  <p className="last-updated">
                    Last updated: {lastUpdated.toLocaleString()}
                  </p>
                </div>
              )}
      </div>
    </AnalyserShell>
  )
}
