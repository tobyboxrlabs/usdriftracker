import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { CONFIG } from './config'
import * as XLSX from 'xlsx'
import { fetchLogsV2 } from './api/blockscout'
import { AnalyserShell } from './components/AnalyserShell'
import { formatAmount, formatAmountDisplay } from './utils/amount'
import { generateDateFilename, writeExcelWorkbook } from './utils/exportExcel'
import { logger } from './utils/logger'
import { rpcCall } from './utils/rpc'
import { isTransientHttpStatus, withBackoff } from './utils/asyncRetry'
import { userFacingError } from './utils/userFacingError'
import './MintRedeemAnalyser.css'

/** Blockscout gettxinfo: retry transient HTTP; null → treat as Success (optimistic). */
async function fetchVaultTxSuccessFromExplorer(txHash: string): Promise<boolean | null> {
  try {
    return await withBackoff(
      async () => {
        const url = `https://rootstock.blockscout.com/api?module=transaction&action=gettxinfo&txhash=${txHash}`
        const res = await fetch(url)
        if (!res.ok) {
          if (isTransientHttpStatus(res.status)) {
            throw new Error(`Blockscout gettxinfo ${res.status}`)
          }
          return null
        }
        const data = await res.json()
        if (data.status === '1' && data.result) {
          return data.result.success !== false
        }
        return null
      },
      { maxAttempts: 4, baseDelayMs: 400 }
    )
  } catch {
    return null
  }
}

interface VaultTransaction {
  time: Date
  hash: string
  status: 'Success' | 'Failed'
  type: 'Deposit' | 'Withdraw'
  amount: string  // Amount of USDRIF deposited/withdrawn (assets)
  receiver: string  // owner for deposits, receiver for withdrawals
  blockNumber: number
}

const BLOCKSCOUT_API_V2 = 'https://rootstock.blockscout.com/api/v2'
const VAULT_ADDRESS = CONFIG.VUSD_ADDRESS.toLowerCase()

// Vault ABI for event signatures
const VAULT_ABI = [
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
] as const

interface VaultDepositWithdrawAnalyserProps {
  initialExpanded?: boolean
  initialDays?: number
}

export default function VaultDepositWithdrawAnalyser({ initialExpanded, initialDays }: VaultDepositWithdrawAnalyserProps = {}) {
  const [transactions, setTransactions] = useState<VaultTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(initialDays ?? 1)
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number; phase: string } | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(!(initialExpanded ?? false))
  const progressTimeoutRef = useRef<number | null>(null)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadingProgress(null)
    
    try {
      // Get current block number via RPC
      const blockNumberHex = await rpcCall<string>('eth_blockNumber', [])
      const currentBlock = parseInt(blockNumberHex, 16)
      
      // Calculate block range
      const blocksPerDay = 2880
      const blockRange = blocksPerDay * days
      const fromBlock = Math.max(0, currentBlock - blockRange)
      
      // Get event topic hashes
      const vaultInterface = new ethers.Interface(VAULT_ABI)
      const depositEvent = vaultInterface.getEvent('Deposit')
      const withdrawEvent = vaultInterface.getEvent('Withdraw')
      
      if (!depositEvent || !withdrawEvent) {
        throw new Error('Failed to get vault event definitions')
      }
      
      const depositTopic = depositEvent.topicHash
      const withdrawTopic = withdrawEvent.topicHash
      
      logger.vault.debug('Event topic hashes:', { deposit: depositTopic, withdraw: withdrawTopic })
      
      // Update progress
      setLoadingProgress({ current: 0, total: 100, phase: 'Fetching vault events...' })
      
      // Fetch all logs from Blockscout API v2
      const allLogs = await fetchLogsV2(BLOCKSCOUT_API_V2, VAULT_ADDRESS, fromBlock, currentBlock)
      
      logger.vault.debug(`Found ${allLogs.length} total logs`)
      
      // Filter for Deposit and Withdraw events
      const vaultEvents = allLogs.filter(log => {
        if (!log.topics || log.topics.length === 0) return false
        const eventTopic = log.topics[0]
        return eventTopic === depositTopic || eventTopic === withdrawTopic
      })
      
      logger.vault.debug(`Found ${vaultEvents.length} vault events (Deposit/Withdraw)`)
      
      setLoadingProgress({ current: 30, total: 100, phase: 'Fetching block timestamps...' })
      
      // Get unique block numbers
      const uniqueBlockNumbers = [...new Set(vaultEvents.map(e => e.block_number))].sort((a, b) => a - b)
      const blockTimestamps = new Map<number, Date>()
      
      // Fetch block timestamps
      const BLOCK_BATCH_SIZE = 5
      const BLOCK_BATCH_DELAY = 100
      const totalBlocks = uniqueBlockNumbers.length
      
      for (let i = 0; i < uniqueBlockNumbers.length; i += BLOCK_BATCH_SIZE) {
        const batch = uniqueBlockNumbers.slice(i, i + BLOCK_BATCH_SIZE)
        
        if (totalBlocks > 0) {
          const blockProgress = 30 + Math.floor((i / totalBlocks) * 40)
          setLoadingProgress({ current: Math.min(blockProgress, 70), total: 100, phase: `Fetching block timestamps... (${Math.min(i + BLOCK_BATCH_SIZE, totalBlocks)}/${totalBlocks} blocks)` })
        }
        
        const blockPromises = batch.map(async (blockNum) => {
          try {
            const blockHex = `0x${blockNum.toString(16)}`
            const blockData = await rpcCall<{ timestamp?: string }>('eth_getBlockByNumber', [blockHex, false])
            
            if (blockData?.timestamp) {
              return { blockNum, timestamp: parseInt(blockData.timestamp, 16) }
            }
            return null
          } catch (err) {
            return null
          }
        })
        
        const results = await Promise.all(blockPromises)
        for (const result of results) {
          if (result) {
            blockTimestamps.set(result.blockNum, new Date(result.timestamp * 1000))
          }
        }
        
        if (i + BLOCK_BATCH_SIZE < uniqueBlockNumbers.length) {
          await new Promise(resolve => setTimeout(resolve, BLOCK_BATCH_DELAY))
        }
      }
      
      setLoadingProgress({ current: 70, total: 100, phase: 'Fetching transaction details...' })
      
      // Fetch transaction statuses
      const uniqueTxHashes = [...new Set(vaultEvents.map(e => e.transaction_hash))]
      const txStatusByHash = new Map<string, 'Success' | 'Failed'>()
      
      const TX_BATCH_SIZE = 5
      const TX_BATCH_DELAY = 150
      const txDetailsLimit = Math.min(uniqueTxHashes.length, 100)
      
      for (let i = 0; i < txDetailsLimit; i += TX_BATCH_SIZE) {
        const batch = uniqueTxHashes.slice(i, i + TX_BATCH_SIZE)
        
        if (txDetailsLimit > 0) {
          const txProgress = 70 + Math.floor((i / txDetailsLimit) * 20)
          setLoadingProgress({ current: Math.min(txProgress, 90), total: 100, phase: `Fetching transaction details... (${Math.min(i + TX_BATCH_SIZE, txDetailsLimit)}/${txDetailsLimit})` })
        }
        
        const txPromises = batch.map(async (txHash) => {
          const successFlag = await fetchVaultTxSuccessFromExplorer(txHash)
          const status: 'Success' | 'Failed' =
            successFlag === false ? 'Failed' : 'Success'
          return { txHash, status }
        })
        
        const results = await Promise.all(txPromises)
        for (const result of results) {
          txStatusByHash.set(result.txHash, result.status)
        }
        
        if (i + TX_BATCH_SIZE < txDetailsLimit) {
          await new Promise(resolve => setTimeout(resolve, TX_BATCH_DELAY))
        }
      }
      
      setLoadingProgress({ current: 90, total: 100, phase: 'Processing transactions...' })
      
      // Process events into transactions
      const txs: VaultTransaction[] = []
      
      for (const log of vaultEvents) {
        const blockNumber = log.block_number
        const timestamp = blockTimestamps.get(blockNumber)
        if (!timestamp) continue
        
        const decoded = log.decoded
        if (!decoded) continue
        
        // Check event type by topic hash (more reliable than method_call)
        const eventTopic = log.topics?.[0]
        const isDeposit = eventTopic === depositTopic
        const isWithdraw = eventTopic === withdrawTopic
        
        if (!isDeposit && !isWithdraw) continue
        
        // Extract parameters
        const params = decoded.parameters || []
        let assets = 0n
        let receiver = ''
        
        if (isDeposit) {
          // Deposit: owner is receiver, assets is amount
          const ownerParam = params.find(p => p.name === 'owner')
          const assetsParam = params.find(p => p.name === 'assets')
          
          if (ownerParam && assetsParam) {
            receiver = ownerParam.value.toLowerCase()
            // Parse assets value - handle both string and number formats
            const assetsValue = assetsParam.value
            if (assetsValue) {
              try {
                assets = BigInt(assetsValue)
              } catch (e) {
                logger.vault.warn(`Failed to parse assets value: ${assetsValue}`, e)
                continue
              }
            }
          }
        } else if (isWithdraw) {
          // Withdraw: receiver is receiver, assets is amount
          const receiverParam = params.find(p => p.name === 'receiver')
          const assetsParam = params.find(p => p.name === 'assets')
          
          if (receiverParam && assetsParam) {
            receiver = receiverParam.value.toLowerCase()
            // Parse assets value - handle both string and number formats
            const assetsValue = assetsParam.value
            if (assetsValue) {
              try {
                assets = BigInt(assetsValue)
              } catch (e) {
                logger.vault.warn(`Failed to parse assets value: ${assetsValue}`, e)
                continue
              }
            }
          }
        }
        
        // Skip if we don't have valid receiver
        if (!receiver) {
          logger.vault.warn(`Skipping event - missing receiver, tx: ${log.transaction_hash}`)
          continue
        }
        
        // Skip if assets is zero (but log it for debugging)
        if (assets === 0n) {
          logger.vault.warn(`Skipping event - zero assets, tx: ${log.transaction_hash}`, params.map(p => `${p.name}=${p.value}`).join(', '))
          continue
        }
        
        const status = txStatusByHash.get(log.transaction_hash) || 'Success'
        
        // Format amount - assets are in wei (18 decimals)
        const formattedAmount = formatAmount(assets, 18)
        
        // Debug logging for first few transactions
        if (txs.length < 3) {
          logger.vault.debug(`${isDeposit ? 'Deposit' : 'Withdraw'}:`, { tx: log.transaction_hash, assets: assets.toString(), formattedAmount, receiver, blockNumber })
        }
        
        txs.push({
          time: timestamp,
          hash: log.transaction_hash,
          status,
          type: isDeposit ? 'Deposit' : 'Withdraw',
          amount: formattedAmount,
          receiver,
          blockNumber,
        })
      }
      
      // Sort by timestamp (newest first) and filter to requested period
      txs.sort((a, b) => b.time.getTime() - a.time.getTime())
      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000)
      const recentTxs = txs.filter(tx => tx.time.getTime() >= cutoffTime)
      
      setTransactions(recentTxs)
      setLastUpdated(new Date())
      setLoadingProgress({ current: 100, total: 100, phase: 'Complete' })
      logger.vault.info(`Fetched ${recentTxs.length} vault txs (${days}d) | blocks ${fromBlock}–${currentBlock}`)
    } catch (err) {
      setError(userFacingError(err))
      logger.vault.error('Error fetching vault transactions:', err)
    } finally {
      setLoading(false)
      if (progressTimeoutRef.current) clearTimeout(progressTimeoutRef.current)
      progressTimeoutRef.current = window.setTimeout(() => setLoadingProgress(null), 500)
    }
  }, [days])

  useEffect(() => {
    if (!isCollapsed) {
      fetchTransactions()
    }
  }, [fetchTransactions, isCollapsed])

  useEffect(() => {
    return () => {
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current)
        progressTimeoutRef.current = null
      }
    }
  }, [])

  const exportToExcel = useCallback((txsToExport: VaultTransaction[]) => {
    try {
      const wb = XLSX.utils.book_new()

      const excelData = txsToExport.map(tx => ({
        'Time (UTC)': tx.time.toISOString().replace('T', ' ').substring(0, 19),
        'TX Hash': tx.hash,
        'Status': tx.status,
        'Asset': 'USDRIF',
        'Type': tx.type,
        'Amount': tx.amount,
        'Receiver': tx.receiver,
        'Block Number': tx.blockNumber,
      }))

      const ws = XLSX.utils.json_to_sheet(excelData)

      // Convert TX Hash column to HYPERLINK formulas
      const txHashColIndex = 1
      const txHashColLetter = XLSX.utils.encode_col(txHashColIndex)
      
      for (let i = 0; i < txsToExport.length; i++) {
        const rowIndex = i + 2
        const tx = txsToExport[i]
        const cellAddress = `${txHashColLetter}${rowIndex}`
        const url = `https://rootstock.blockscout.com/tx/${tx.hash}`
        const displayText = tx.hash.substring(0, 10) + '...' + tx.hash.substring(tx.hash.length - 8)
        
        ws[cellAddress] = {
          t: 's',
          f: `HYPERLINK("${url}","${displayText}")`,
        }
      }

      ws['!cols'] = [
        { wch: 20 },
        { wch: 25 },
        { wch: 12 },
        { wch: 12 },
        { wch: 15 },
        { wch: 30 },
        { wch: 45 },
        { wch: 15 },
      ]

      const summaryStartRow = excelData.length + 3
      const summaryData = [
        {},
        { 'Time (UTC)': 'Total Transactions:', 'Status': txsToExport.length },
        { 'Time (UTC)': 'Deposits:', 'Status': txsToExport.filter(tx => tx.type === 'Deposit').length },
        { 'Time (UTC)': 'Withdrawals:', 'Status': txsToExport.filter(tx => tx.type === 'Withdraw').length },
      ]
      
      XLSX.utils.sheet_add_json(ws, summaryData, { origin: `A${summaryStartRow}`, skipHeader: true })

      const sheetName = 'vUSD Transactions'
      XLSX.utils.book_append_sheet(wb, ws, sheetName)

      const filename = generateDateFilename('usd_vault_txs')
      writeExcelWorkbook(wb, filename)
    } catch (error) {
      logger.vault.error('Error exporting to Excel:', error)
      alert('Failed to export to Excel. Please try again.')
    }
  }, [])

  const controls = (
    <>
      <div className="filter-toggle">
        {/* No filter buttons needed for vault - only one asset type */}
      </div>
      <div className="right-controls">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <button
          onClick={fetchTransactions}
          disabled={loading}
          aria-busy={loading}
        >
          {loading && <span className="refresh-spinner"></span>}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button
          className="export-button"
          onClick={() => exportToExcel(transactions)}
          disabled={loading}
        >
          XLS
        </button>
      </div>
    </>
  )

  return (
    <AnalyserShell
      title="USD Vault"
      networkBadge="mainnet"
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      controls={controls}
      error={error}
      loading={loading}
      loadingProgress={loadingProgress}
      isEmpty={transactions.length === 0}
      emptyMessage="No vault transactions found in the selected period."
    >
      <div className="transactions-table-container">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Status</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Receiver</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, idx) => (
                <tr key={`${tx.hash}-${idx}`}>
                  <td className="hash-cell">
                    <a
                      href={`https://rootstock.blockscout.com/tx/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={tx.hash}
                    >
                      {tx.time.toISOString().replace('T', ' ').substring(0, 19)}
                    </a>
                  </td>
                  <td>{tx.status}</td>
                  <td>USDRIF</td>
                  <td className={tx.type === 'Deposit' ? 'type-mint' : 'type-redeem'}>
                    {tx.type}
                  </td>
                  <td title={tx.amount}>
                    {formatAmountDisplay(tx.amount, 0)}
                  </td>
                  <td className="address-cell">
                    <a
                      href={`https://rootstock.blockscout.com/address/${tx.receiver}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={tx.receiver}
                    >
                      {tx.receiver}
                    </a>
                  </td>
                  <td className="address-cell">
                    <a
                      href={`https://rootstock.blockscout.com/block/${tx.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={tx.blockNumber.toString()}
                    >
                      {tx.blockNumber}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="transactions-summary">
            <div className="summary-row">
              <p>
                Total Transactions: {transactions.length}, 
                Deposits: {transactions.filter(tx => tx.type === 'Deposit').length} | 
                Withdrawals: {transactions.filter(tx => tx.type === 'Withdraw').length}
                {(() => {
                  const depositTotal = transactions
                    .filter(tx => tx.type === 'Deposit')
                    .reduce((sum, tx) => sum + parseFloat(tx.amount || '0'), 0)
                  
                  const withdrawalTotal = transactions
                    .filter(tx => tx.type === 'Withdraw')
                    .reduce((sum, tx) => sum + parseFloat(tx.amount || '0'), 0)
                  
                  return (
                    <>, Deposits total: {formatAmountDisplay(depositTotal.toString(), 0)} | 
                    Withdrawals total: {formatAmountDisplay(withdrawalTotal.toString(), 0)}</>
                  )
                })()}
              </p>
              {lastUpdated && (
                <p className="last-updated">
                  Last updated: {lastUpdated.getFullYear()}{String(lastUpdated.getMonth() + 1).padStart(2, '0')}{String(lastUpdated.getDate()).padStart(2, '0')} {String(lastUpdated.getHours()).padStart(2, '0')}:{String(lastUpdated.getMinutes()).padStart(2, '0')}:{String(lastUpdated.getSeconds()).padStart(2, '0')}.{String(Math.floor(lastUpdated.getMilliseconds() / 10)).padStart(2, '0')}
                </p>
              )}
            </div>
          </div>
        </div>
    </AnalyserShell>
  )
}
