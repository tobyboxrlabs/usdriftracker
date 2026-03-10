import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { CONFIG } from './config'
import * as XLSX from 'xlsx'
import './MintRedeemAnalyser.css'

interface VaultTransaction {
  time: Date
  hash: string
  status: 'Success' | 'Failed'
  type: 'Deposit' | 'Withdraw'
  amount: string  // Amount of USDRIF deposited/withdrawn (assets)
  receiver: string  // owner for deposits, receiver for withdrawals
  blockNumber: number
}

interface BlockscoutV2Log {
  address: {
    hash: string
  }
  block_number: number
  block_timestamp: string
  data: string
  decoded: {
    method_call: string
    parameters: Array<{
      name: string
      type: string
      value: string
    }>
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

const BLOCKSCOUT_API_V2 = 'https://rootstock.blockscout.com/api/v2'
const VAULT_ADDRESS = CONFIG.VUSD_ADDRESS.toLowerCase()

// Vault ABI for event signatures
const VAULT_ABI = [
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
] as const

// Global rate limiter for Blockscout API v2 calls
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
      
      if (delayNeeded > 0) {
        await new Promise(r => setTimeout(r, delayNeeded))
      }
      
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

const blockscoutV2RateLimiter = new BlockscoutV2RateLimiter()

async function fetchLogsFromBlockscoutV2(
  address: string,
  fromBlock: number,
  toBlock: number,
  retryCount = 0
): Promise<BlockscoutV2Log[]> {
  await blockscoutV2RateLimiter.throttle()
  
  // Blockscout API v2 uses pagination with next_page_params
  // We'll fetch all pages until we get all logs in the range
  const allLogs: BlockscoutV2Log[] = []
  let nextPageParams: BlockscoutV2Response['next_page_params'] = null
  let pageCount = 0
  const MAX_PAGES = 100 // Safety limit
  let hasMorePages = true
  const FETCH_TIMEOUT = 30000 // 30 seconds timeout
  
  while (hasMorePages && pageCount < MAX_PAGES) {
    try {
      // Build URL with query parameters
      // Note: Blockscout API v2 doesn't support filter[from_block] or filter[to_block] parameters
      // We'll fetch logs and filter client-side by block range
      let url = `${BLOCKSCOUT_API_V2}/addresses/${address}/logs`
      const params = new URLSearchParams()
      
      // Add pagination params if we have them (for subsequent pages)
      if (nextPageParams) {
        // Use next_page_params to continue pagination
        // The API returns these in the response for pagination
        if (nextPageParams.block_number !== undefined) {
          // Note: API v2 pagination might use different params - check response structure
        }
        if (nextPageParams.index !== undefined) {
          params.append('index', nextPageParams.index.toString())
        }
        if (nextPageParams.items_count !== undefined) {
          params.append('items_count', nextPageParams.items_count.toString())
        }
      }
      
      if (params.toString()) {
        url += '?' + params.toString()
      }
      
      // Create AbortController for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
      
      let response: Response
      try {
        response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
      } catch (fetchError) {
        clearTimeout(timeoutId)
        
        // Handle network errors and timeouts
        if (fetchError instanceof Error) {
          const isTimeout = fetchError.name === 'AbortError' || fetchError.message.includes('timeout')
          const isNetworkError = fetchError.message.includes('Failed to fetch') || 
                                 fetchError.message.includes('network') ||
                                 fetchError.message.includes('ERR_CONNECTION') ||
                                 fetchError.message.includes('ERR_TIMED_OUT')
          
          if ((isTimeout || isNetworkError) && retryCount < 3) {
            blockscoutV2RateLimiter.recordFailure()
            const retryDelay = Math.min(2000 * Math.pow(2, retryCount), 10000)
            console.warn(`[Blockscout V2] Network error/timeout, retrying after ${retryDelay}ms... (attempt ${retryCount + 1}/3)`)
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
          }
          
          if (isTimeout || isNetworkError) {
            throw new Error(`Blockscout API v2 request timed out or network error. The API may be temporarily unavailable. Please check your internet connection and try again later.`)
          }
        }
        throw fetchError
      }
      
      if (response.status === 429) {
        blockscoutV2RateLimiter.recordFailure()
        if (retryCount < 3) {
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000)
          console.warn(`[Blockscout V2] Rate limited (429), retrying after ${retryDelay}ms... (attempt ${retryCount + 1}/3)`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
        }
        throw new Error(`Blockscout API v2 rate limited. Too many requests. Please try again later or reduce the lookback period.`)
      }
      
      if (!response.ok) {
        blockscoutV2RateLimiter.recordFailure()
        if (response.status === 503) {
          throw new Error(`Blockscout API v2 is temporarily unavailable (503). Please try again in a few moments.`)
        }
        throw new Error(`Blockscout API v2 error (${response.status}): ${response.statusText}. Please try again later.`)
      }
      
      blockscoutV2RateLimiter.recordSuccess()
      
      const text = await response.text()
      if (!text || text.trim().length === 0) {
        break
      }
      
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        blockscoutV2RateLimiter.recordFailure()
        throw new Error(`Blockscout API v2 returned non-JSON response: ${text.substring(0, 200)}`)
      }
      
      const data = JSON.parse(text) as BlockscoutV2Response
      
      if (data.items && data.items.length > 0) {
        // Filter logs by block range (API v2 doesn't support block range filters)
        // API returns logs in descending order (newest first)
        const filteredItems = data.items.filter(log => {
          const blockNum = log.block_number
          return blockNum >= fromBlock && blockNum <= toBlock
        })
        allLogs.push(...filteredItems)
        
        // Check if we should stop paginating
        // API returns newest first, so we start with high block numbers and go backwards
        const minBlockInPage = Math.min(...data.items.map(log => log.block_number))
        const maxBlockInPage = Math.max(...data.items.map(log => log.block_number))
        
        // If the highest block in this page is less than fromBlock, we've gone too far back
        if (maxBlockInPage < fromBlock) {
          // All blocks in this page are before our range, stop fetching
          hasMorePages = false
          break
        }
        
        // If the lowest block in this page is greater than toBlock, we're still too recent
        // Continue fetching to go further back in time
        // (This shouldn't happen if we're fetching correctly, but good to check)
        if (minBlockInPage > toBlock) {
          // All blocks are after our range, continue fetching to go back further
          // Don't break, keep going
        }
      } else {
        // No items returned, we're done
        hasMorePages = false
        break
      }
      
      // Check if there are more pages
      nextPageParams = data.next_page_params
      if (!nextPageParams) {
        hasMorePages = false
        break
      }
      
      pageCount++
      
      // Small delay between pages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
      
    } catch (fetchError) {
      blockscoutV2RateLimiter.recordFailure()
      
      // Handle retries for rate limiting
      if (retryCount < 3 && fetchError instanceof Error && fetchError.message.includes('429')) {
        const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
      }
      
      // Handle network errors that weren't caught above
      if (retryCount < 3 && fetchError instanceof Error) {
        const isNetworkError = fetchError.message.includes('Failed to fetch') || 
                               fetchError.message.includes('network') ||
                               fetchError.message.includes('ERR_CONNECTION') ||
                               fetchError.message.includes('ERR_TIMED_OUT') ||
                               fetchError.message.includes('timeout')
        
        if (isNetworkError) {
          const retryDelay = Math.min(2000 * Math.pow(2, retryCount), 10000)
          console.warn(`[Blockscout V2] Network error, retrying after ${retryDelay}ms... (attempt ${retryCount + 1}/3)`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
        }
      }
      
      throw fetchError
    }
  }
  
  return allLogs
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
  const numValue = parseFloat(amount)
  if (isNaN(numValue)) return amount
  return numValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export default function VaultDepositWithdrawAnalyser() {
  const [transactions, setTransactions] = useState<VaultTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(1)
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number; phase: string } | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Helper function to make RPC calls
  const makeRpcCall = useCallback(async (method: string, params: any[]): Promise<any> => {
    const isDev = import.meta.env.DEV
    const primaryRpcEndpoint = CONFIG.ROOTSTOCK_RPC || 'https://public-node.rsk.co'
    
    const fallbackEndpoints = CONFIG.ROOTSTOCK_RPC_ALTERNATIVES || [
      'https://public-node.rsk.co',
      'https://rsk.publicnode.com',
    ]
    
    const endpointsToTry = isDev
      ? [primaryRpcEndpoint, ...fallbackEndpoints]
      : [
          `/api/rpc?target=${encodeURIComponent(primaryRpcEndpoint)}`,
          ...fallbackEndpoints.map(ep => `/api/rpc?target=${encodeURIComponent(ep)}`),
          primaryRpcEndpoint,
          ...fallbackEndpoints
        ]
    
    let lastError: Error | null = null
    
    for (const targetUrl of endpointsToTry) {
      const isDirectRpc = !targetUrl.startsWith('/api/')
      
      try {
        const requestHeaders: HeadersInit = { 'Content-Type': 'application/json' }
        
        if (!isDirectRpc) {
          const clientVersion = CONFIG.CLIENT_VERSION || 'unknown'
          requestHeaders['x-client-version'] = clientVersion
        }
        
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
          }),
        })
        
        if (response.status === 410 || response.status === 404) {
          if (response.status === 404 && isDev && !isDirectRpc) {
            lastError = new Error(`Proxy unavailable in dev mode`)
            continue
          }
          lastError = new Error(`RPC endpoint unavailable: ${response.status} ${response.statusText}`)
          continue
        }
        
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) {
            lastError = new Error(`RPC error: ${response.status} ${response.statusText}`)
            continue
          }
          throw new Error(`RPC server error: ${response.status} ${response.statusText}`)
        }
        
        const responseText = await response.text()
        if (!responseText || responseText.trim().length === 0) {
          lastError = new Error('RPC returned empty response')
          continue
        }
        
        const data = JSON.parse(responseText)
        if (data.error) {
          throw new Error(data.error.message || 'RPC error')
        }
        
        return data.result
      } catch (rpcError) {
        const isCorsError = rpcError instanceof TypeError && 
          (rpcError.message.includes('CORS') || 
           rpcError.message.includes('Failed to fetch') ||
           rpcError.message.includes('network'))
        
        if (isCorsError && isDirectRpc) {
          lastError = rpcError as Error
          continue
        }
        
        if (rpcError instanceof SyntaxError || 
            (rpcError instanceof Error && (rpcError.message.includes('fetch') || rpcError.message.includes('network')))) {
          lastError = rpcError as Error
          continue
        }
        throw rpcError
      }
    }
    
    throw new Error(`Failed to fetch RPC data from all endpoints: ${lastError?.message || 'Unknown error'}`)
  }, [])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadingProgress(null)
    
    try {
      // Get current block number via RPC
      const blockNumberHex = await makeRpcCall('eth_blockNumber', [])
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
      
      console.log(`[DEBUG] Vault event topic hashes:`, {
        deposit: depositTopic,
        withdraw: withdrawTopic,
      })
      
      // Update progress
      setLoadingProgress({ current: 0, total: 100, phase: 'Fetching vault events...' })
      
      // Fetch all logs from Blockscout API v2
      const allLogs = await fetchLogsFromBlockscoutV2(VAULT_ADDRESS, fromBlock, currentBlock)
      
      console.log(`[DEBUG] Found ${allLogs.length} total logs`)
      
      // Filter for Deposit and Withdraw events
      const vaultEvents = allLogs.filter(log => {
        if (!log.topics || log.topics.length === 0) return false
        const eventTopic = log.topics[0]
        return eventTopic === depositTopic || eventTopic === withdrawTopic
      })
      
      console.log(`[DEBUG] Found ${vaultEvents.length} vault events (Deposit/Withdraw)`)
      
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
            const blockData = await makeRpcCall('eth_getBlockByNumber', [blockHex, false])
            
            if (blockData && blockData.timestamp) {
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
          try {
            const txInfoUrl = `https://rootstock.blockscout.com/api?module=transaction&action=gettxinfo&txhash=${txHash}`
            const txInfoResponse = await fetch(txInfoUrl)
            
            if (txInfoResponse.ok) {
              const txInfoData = await txInfoResponse.json()
              if (txInfoData.status === '1' && txInfoData.result) {
                return {
                  txHash,
                  status: txInfoData.result.status === '1' ? 'Success' as const : 'Failed' as const
                }
              }
            }
            
            // Fallback: assume success if event was emitted
            return { txHash, status: 'Success' as const }
          } catch {
            return { txHash, status: 'Success' as const }
          }
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
                console.warn(`[Vault] Failed to parse assets value: ${assetsValue}`, e)
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
                console.warn(`[Vault] Failed to parse assets value: ${assetsValue}`, e)
                continue
              }
            }
          }
        }
        
        // Skip if we don't have valid receiver
        if (!receiver) {
          console.warn(`[Vault] Skipping event - missing receiver, tx: ${log.transaction_hash}`)
          continue
        }
        
        // Skip if assets is zero (but log it for debugging)
        if (assets === 0n) {
          console.warn(`[Vault] Skipping event - zero assets, tx: ${log.transaction_hash}, params:`, params.map(p => `${p.name}=${p.value}`).join(', '))
          continue
        }
        
        const status = txStatusByHash.get(log.transaction_hash) || 'Success'
        
        // Format amount - assets are in wei (18 decimals)
        const formattedAmount = formatAmount(assets, 18)
        
        // Debug logging for first few transactions
        if (txs.length < 3) {
          console.log(`[Vault] Processing ${isDeposit ? 'Deposit' : 'Withdraw'}:`, {
            tx: log.transaction_hash,
            assets: assets.toString(),
            formattedAmount,
            receiver,
            blockNumber,
          })
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions')
      console.error('Error fetching vault transactions:', err)
    } finally {
      setLoading(false)
      setTimeout(() => setLoadingProgress(null), 500)
    }
  }, [days, makeRpcCall])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

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

      const sheetName = 'USD Vault Transactions'
      XLSX.utils.book_append_sheet(wb, ws, sheetName)

      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')
      const day = String(today.getDate()).padStart(2, '0')
      const filename = `usd_vault_txs_${year}${month}${day}.xlsx`

      XLSX.writeFile(wb, filename)
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      alert('Failed to export to Excel. Please try again.')
    }
  }, [])

  return (
    <div className="mint-redeem-analyser">
      <div className="analyser-header">
        <h2>USD Vault Deposits/Withdrawals Analyser</h2>
        <div className="analyser-controls">
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
        </div>
      </div>

      {error && (
        <div className="error-message">
          Error: {error}
        </div>
      )}

      {loading && (
        <div className="loading-message" role="status" aria-live="polite">
          {loadingProgress ? (
            <>
              <div>{loadingProgress.phase}</div>
              <div className="loading-progress">
                {loadingProgress.total > 0 ? (
                  <div className="loading-progress-row">
                    <div className="loading-progress-bar">
                      <div 
                        className={`loading-progress-fill ${loadingProgress.current === 100 ? 'complete' : ''}`}
                        style={{ width: `${Math.min(100, (loadingProgress.current / loadingProgress.total) * 100)}%` }}
                      />
                    </div>
                    <div className="loading-progress-text">
                      {loadingProgress.current}%
                    </div>
                  </div>
                ) : (
                  <div>Initializing...</div>
                )}
              </div>
            </>
          ) : (
            'Loading transactions...'
          )}
        </div>
      )}

      {!loading && transactions.length === 0 && !error && (
        <div className="no-data" role="status" aria-live="polite">
          No vault transactions found in the selected period.
        </div>
      )}

      {transactions.length > 0 && !loading && (
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
      )}
    </div>
  )
}
