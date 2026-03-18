import { useState, useCallback, useEffect } from 'react'
import { ethers } from 'ethers'
import { CONFIG } from './config'
import * as XLSX from 'xlsx'
import { RootstockLogo } from './RootstockLogo'
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

interface BlockscoutV2Log {
  address: { hash: string }
  block_number: number
  block_timestamp: string
  data: string
  decoded: {
    method_call: string
    parameters: Array<{ name: string; type: string; value: string }>
  } | null
  topics: (string | null)[]
  transaction_hash: string
  index: number
}

interface BlockscoutV2Response {
  items: BlockscoutV2Log[]
  next_page_params: {
    block_number?: number
    index?: number
    items_count?: number
  } | null
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

class BlockscoutV2RateLimiter {
  private lastCallTime = 0
  private callQueue: Array<() => void> = []
  private isProcessing = false
  private consecutiveFailures = 0
  private readonly MIN_DELAY = 200
  private readonly MAX_DELAY = 5000

  async throttle(): Promise<void> {
    return new Promise((resolve) => {
      this.callQueue.push(resolve)
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.callQueue.length === 0) return
    this.isProcessing = true
    while (this.callQueue.length > 0) {
      const resolve = this.callQueue.shift()!
      const adaptiveDelay = Math.min(
        this.MIN_DELAY * Math.pow(2, Math.min(this.consecutiveFailures, 4)),
        this.MAX_DELAY
      )
      const timeSinceLastCall = Date.now() - this.lastCallTime
      const delayNeeded = Math.max(adaptiveDelay - timeSinceLastCall, 0)
      if (delayNeeded > 0) await new Promise((r) => setTimeout(r, delayNeeded))
      this.lastCallTime = Date.now()
      resolve()
    }
    this.isProcessing = false
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
  }
  recordFailure(): void {
    this.consecutiveFailures++
  }
}

const rateLimiter = new BlockscoutV2RateLimiter()

async function fetchLogsFromBlockscoutV2(
  address: string,
  fromBlock: number,
  toBlock: number,
  retryCount = 0
): Promise<BlockscoutV2Log[]> {
  await rateLimiter.throttle()
  const allLogs: BlockscoutV2Log[] = []
  let nextPageParams: BlockscoutV2Response['next_page_params'] = null
  let pageCount = 0
  let hasMorePages = true
  const FETCH_TIMEOUT = 30000

  while (hasMorePages && pageCount < 100) {
    try {
      let url = `${BLOCKSCOUT_API_V2}/addresses/${address}/logs`
      const params = new URLSearchParams()
      if (nextPageParams) {
        if (nextPageParams.index !== undefined) params.append('index', String(nextPageParams.index))
        if (nextPageParams.items_count !== undefined) params.append('items_count', String(nextPageParams.items_count))
      }
      if (params.toString()) url += '?' + params.toString()

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
      let response: Response
      try {
        response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
      } catch (fetchError) {
        clearTimeout(timeoutId)
        if (fetchError instanceof Error) {
          const isRetryable =
            (fetchError.name === 'AbortError' || /timeout|Failed to fetch|network|ERR_/i.test(fetchError.message)) &&
            retryCount < 3
          if (isRetryable) {
            rateLimiter.recordFailure()
            await new Promise((r) => setTimeout(r, Math.min(2000 * Math.pow(2, retryCount), 10000)))
            return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
          }
        }
        throw fetchError
      }

      if (response.status === 429 && retryCount < 3) {
        rateLimiter.recordFailure()
        await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, retryCount), 5000)))
        return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
      }
      if (!response.ok) {
        rateLimiter.recordFailure()
        throw new Error(`Blockscout API v2 error: ${response.status}`)
      }
      rateLimiter.recordSuccess()

      const text = await response.text()
      if (!text?.trim()) break
      if (!response.headers.get('content-type')?.includes('application/json')) {
        rateLimiter.recordFailure()
        throw new Error('Blockscout returned non-JSON')
      }
      const data = JSON.parse(text) as BlockscoutV2Response

      if (data.items?.length) {
        const filtered = data.items.filter((log) => {
          const b = log.block_number
          return b >= fromBlock && b <= toBlock
        })
        allLogs.push(...filtered)
        if (Math.max(...data.items.map((l) => l.block_number)) < fromBlock) {
          hasMorePages = false
          break
        }
      } else {
        hasMorePages = false
        break
      }
      nextPageParams = data.next_page_params
      if (!nextPageParams) hasMorePages = false
      else pageCount++
      await new Promise((r) => setTimeout(r, 100))
    } catch (err) {
      rateLimiter.recordFailure()
      if (retryCount < 3 && err instanceof Error && /Failed to fetch|network|ERR_|timeout/.test(err.message)) {
        await new Promise((r) => setTimeout(r, Math.min(2000 * Math.pow(2, retryCount), 10000)))
        return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
      }
      throw err
    }
  }
  return allLogs
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

function formatAmount(amount: bigint, decimals: number = 18): string {
  if (amount === 0n) return '0'
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

function formatAmountDisplay(amount: string, decimals: number = 0): string {
  const n = parseFloat(amount)
  if (isNaN(n)) return amount
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
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
      const blockNumRes = await fetch(CONFIG.RSK_TESTNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      })
      const blockNumData = await blockNumRes.json()
      const currentBlock = parseInt(blockNumData.result ?? '0x0', 16)

      const blockRange = BLOCKS_PER_DAY * days
      const fromBlock = Math.max(0, currentBlock - blockRange)

      const logs = await fetchLogsFromBlockscoutV2(VAULT_ADDRESS, fromBlock, currentBlock)
      const decoded = logs
        .map(decodeEvent)
        .filter((t): t is BTCVaultTransaction => t !== null)
      decoded.sort((a, b) => b.time.getTime() - a.time.getTime())
      setTransactions(decoded)
      setLastUpdated(new Date())
      const price = await fetchRbtcUsdPrice()
      setRbtcUsd(price)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
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
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    XLSX.writeFile(wb, `btc-vault-transactions-${ts}.xlsx`)
  }, [transactions, rbtcUsd])

  return (
    <div className={`mint-redeem-analyser ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="analyser-header">
        <h2>BTC Vault</h2>
        <span className="network-badge network-badge--testnet" title="Rootstock Testnet">
          <RootstockLogo className="network-badge__logo" />
          Testnet
        </span>
        <button
          className="collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        {!isCollapsed && (
          <div className="analyser-controls">
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
          </div>
        )}
      </div>

      {!isCollapsed && (
        <>
          {error && <div className="error-message">Error: {error}</div>}
          {loading && (
            <div className="loading-message" role="status" aria-live="polite">
              Loading transactions...
            </div>
          )}
          {!loading && transactions.length === 0 && !error && (
            <div className="no-data" role="status" aria-live="polite">
              No BTC Vault transactions found in the selected period.
            </div>
          )}
          {transactions.length > 0 && !loading && (
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
          )}
        </>
      )}
    </div>
  )
}
