import { useState, useCallback, useEffect } from 'react'
import { ethers } from 'ethers'
import { CONFIG } from './config'
import * as XLSX from 'xlsx'
import { fetchLogsV2, type BlockscoutV2Log } from './api/blockscout'
import { rpcCall } from './utils/rpc'
import { userFacingError } from './utils/userFacingError'
import { AnalyserShell } from './components/AnalyserShell'
import { formatAmount, formatAmountDisplay } from './utils/amount'
import { generateTimestampFilename, writeExcelWorkbook } from './utils/exportExcel'
import './MintRedeemAnalyser.css'

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

const BLOCKSCOUT_API_V2 = CONFIG.RSK_TESTNET_BLOCKSCOUT_V2
const VAULT_ADDRESS = CONFIG.BTC_VAULT_RBTC_ASYNC_VAULT_PROXY.toLowerCase()
const TESTNET_EXPLORER = 'https://rootstock-testnet.blockscout.com'
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
}

function parseBigInt(value: string): string {
  try {
    return BigInt(value).toString()
  } catch {
    return value
  }
}

function decodeEvent(log: BlockscoutV2Log): BTCVaultTransaction | null {
  if (!log.decoded?.parameters || !log.topics[0]) return null
  const topic0 = (log.topics[0] as string).toLowerCase()
  const params = log.decoded.parameters
  const get = (name: string) => params.find((p) => p.name === name)?.value ?? '0'

  const base = (status: BTCVaultTransaction['status'], type: BTCVaultTransaction['type']) => ({
    time: new Date(log.block_timestamp),
    hash: log.transaction_hash,
    status,
    type,
    user: get('user'),
    receiver: get('receiver'),
    amount: parseBigInt(get('amount')),
    shares: parseBigInt(get('shares')),
    token: get('token') ?? '',
    assetToken: get('assetToken') ?? '',
    blockNumber: log.block_number,
  })

  if (topic0 === TOPICS.DepositRequest) {
    return { ...base('Requested', 'Deposit Request'), shares: parseBigInt(get('shares')), token: get('token') }
  }
  if (topic0 === TOPICS.NativeDepositRequested) {
    return { ...base('Requested', 'Deposit Request'), token: '0x0000000000000000000000000000000000000000' }
  }
  if (topic0 === TOPICS.DepositClaimed) {
    const epochIdParam = get('epochId')
    return { ...base('Claimed', 'Deposit Claimed'), epochId: epochIdParam ? parseInt(epochIdParam, 10) : undefined }
  }
  if (topic0 === TOPICS.DepositRequestCancelled || topic0 === TOPICS.NativeDepositRequestCancelled) {
    return { ...base('Cancelled', 'Deposit Request') }
  }
  if (topic0 === TOPICS.RedeemRequest) {
    return base('Requested', 'Redeem Request')
  }
  if (topic0 === TOPICS.RedeemClaimed) {
    const epochIdParam = get('epochId')
    return {
      ...base('Claimed', 'Redeem Claimed'),
      assetToken: get('assetToken'),
      epochId: epochIdParam ? parseInt(epochIdParam, 10) : undefined,
    }
  }
  if (topic0 === TOPICS.RedeemRequestCancelled) {
    return base('Cancelled', 'Redeem Request')
  }
  if (topic0 === TOPICS.SyntheticYieldApplied) {
    return {
      ...base('Claimed', 'Yield Applied'),
      user: get('caller'),
      receiver: '',
      shares: '0',
      token: '',
      assetToken: '',
      epochId: get('epochId') ? parseInt(get('epochId'), 10) : undefined,
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
  initialExpanded?: boolean
  initialDays?: number
}

export default function BTCVaultAnalyser({ initialExpanded, initialDays }: BTCVaultAnalyserProps = {}) {
  const [transactions, setTransactions] = useState<BTCVaultTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(initialDays ?? 7)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(!(initialExpanded ?? false))
  const [rbtcUsd, setRbtcUsd] = useState<number | null>(null)

  const loadPrice = useCallback(async () => {
    const price = await fetchRbtcUsdPrice()
    setRbtcUsd(price)
  }, [])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const blockNumberHex = await rpcCall<string>('eth_blockNumber', [], CONFIG.RSK_TESTNET_RPC)
      const currentBlock = parseInt(blockNumberHex ?? '0x0', 16)

      const blockRange = BLOCKS_PER_DAY * days
      const fromBlock = Math.max(0, currentBlock - blockRange)

      const logs = await fetchLogsV2(BLOCKSCOUT_API_V2, VAULT_ADDRESS, fromBlock, currentBlock)
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
  }, [days])

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
      return {
        'Timestamp': tx.time.toISOString(),
        'Tx Hash': tx.hash,
        'Type': tx.type,
        'Status': tx.status,
        'User': tx.user,
        'Receiver': tx.receiver,
        'Amount (RBTC)': amountRbtc,
        'USD Equiv.': usdEquiv != null ? formatUsd(usdEquiv) : '',
        'Shares': formatAmountDisplay(formatAmount(BigInt(tx.shares), 18), 8),
        'Epoch ID': tx.epochId ?? '',
        'Block': tx.blockNumber,
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BTC Vault Transactions')
    const filename = generateTimestampFilename('btc-vault-transactions')
    writeExcelWorkbook(wb, filename)
  }, [transactions, rbtcUsd])

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
      networkBadge="testnet"
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      controls={controls}
      error={error}
      loading={loading}
      isEmpty={transactions.length === 0}
      emptyMessage="No BTC Vault transactions found in the selected period."
    >
      <div className="transactions-table-container">
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Amount (RBTC)</th>
                    <th>USD Equiv.</th>
                    <th>User</th>
                    <th>Epoch</th>
                    <th>Block</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, idx) => (
                    <tr key={`${tx.hash}-${idx}`}>
                      <td className="hash-cell">
                        <a href={`${TESTNET_EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" title={tx.hash}>
                          {tx.time.toISOString().replace('T', ' ').substring(0, 19)}
                        </a>
                      </td>
                      <td>{tx.status}</td>
                      <td className={tx.type.includes('Deposit') ? 'type-mint' : tx.type.includes('Redeem') ? 'type-redeem' : ''}>
                        {tx.type}
                      </td>
                      <td title={tx.amount}>
                        {formatAmountDisplay(formatAmount(BigInt(tx.amount), 18), 8)}
                      </td>
                      <td>
                        {rbtcUsd != null
                          ? formatUsd(parseFloat(formatAmount(BigInt(tx.amount), 18)) * rbtcUsd)
                          : '—'}
                      </td>
                      <td className="address-cell">
                        <a href={`${TESTNET_EXPLORER}/address/${tx.user}`} target="_blank" rel="noopener noreferrer" title={tx.user}>
                          {tx.user.slice(0, 6)}…{tx.user.slice(-4)}
                        </a>
                      </td>
                      <td>{tx.epochId ?? '—'}</td>
                      <td>
                        <a href={`${TESTNET_EXPLORER}/block/${tx.blockNumber}`} target="_blank" rel="noopener noreferrer">
                          {tx.blockNumber}
                        </a>
                      </td>
                    </tr>
                  ))}
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
