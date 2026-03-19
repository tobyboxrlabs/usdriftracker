import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { CONFIG } from './config'
import * as XLSX from 'xlsx'
import { fetchLogsV1, type BlockscoutLog } from './api/blockscout'
import { AnalyserShell } from './components/AnalyserShell'
import { formatAmount, formatAmountDisplay } from './utils/amount'
import { generateDateFilename, writeExcelWorkbook } from './utils/exportExcel'
import { rpcCall } from './utils/rpc'
import './MintRedeemAnalyser.css'

interface MintRedeemTransaction {
  time: Date
  hash: string
  status: 'Success' | 'Failed'
  type: 'USDRIF Mint' | 'USDRIF Redeem' | 'RifPro Mint' | 'RifPro Redeem'
  amountMintedRedeemed: string
  receiver: string
  amountSentReceived: string
  returned: boolean
  valueReturned: string
  tokenReturned: string
  blockNumber: number
}

const BLOCKSCOUT_API = 'https://rootstock.blockscout.com/api'
const USDRIF_ADDRESS = CONFIG.USDRIF_ADDRESS
const RIFPRO_ADDRESS = CONFIG.RIFPRO_ADDRESS
const RIF_TOKEN_ADDRESS = '0x2acc95758f8b5f583470ba265eb685a8f45fc9d5' // RIF token (collateral)
const MOC_V2_CORE = CONFIG.MOC_V2_CORE // MoC V2 Core contract (receives/locks RIF collateral)
const MOC_CONTRACT_ADDRESSES = [
  '0xf773B590aF754D597770937Fa8ea7AbDf2668370', // Mainnet MoC contract
  CONFIG.MOC_V2_CORE, // MoC V2 Core
  '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257', // MoC State
]
const MOC_CONTRACT_NAMES: Record<string, string> = {
  [MOC_CONTRACT_ADDRESSES[0].toLowerCase()]: 'MoC',
  [CONFIG.MOC_V2_CORE.toLowerCase()]: 'MoC V2 Core',
  [MOC_CONTRACT_ADDRESSES[2].toLowerCase()]: 'MoC State',
}
const ROC_CONTRACTS_LABEL = MOC_CONTRACT_ADDRESSES.map(a => MOC_CONTRACT_NAMES[a.toLowerCase()]).join(', ')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// MoC Contract ABI for minting/redeeming functions and events
const MOC_ABI = [
  // Functions
  'function mintStableToken(uint256 reserveTokenAmount, address vendorAccount)',
  'function mintStableTokenVendors(uint256 reserveTokenAmount, address vendorAccount)',
  'function redeemFreeStableToken(uint256 stableTokenAmount, address vendorAccount)',
  'function redeemFreeStableTokenVendors(uint256 stableTokenAmount, address vendorAccount)',
  // Events
  'event MintStableToken(address indexed account, uint256 reserveTokenAmount, uint256 stableTokenAmount, address indexed vendorAccount)',
  'event RedeemFreeStableToken(address indexed account, uint256 stableTokenAmount, uint256 reserveTokenAmount, address indexed vendorAccount)',
  'event MintStableTokenVendors(address indexed account, uint256 reserveTokenAmount, uint256 stableTokenAmount, address indexed vendorAccount)',
  'event RedeemFreeStableTokenVendors(address indexed account, uint256 stableTokenAmount, uint256 reserveTokenAmount, address indexed vendorAccount)',
] as const

interface MintRedeemAnalyserProps {
  initialExpanded?: boolean
  initialDays?: number
}

export default function MintRedeemAnalyser({ initialExpanded, initialDays }: MintRedeemAnalyserProps = {}) {
  const [transactions, setTransactions] = useState<MintRedeemTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(initialDays ?? 1)
  const [tokenFilter, setTokenFilter] = useState<'USDRIF' | 'RifPro' | 'All'>('All')
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number; phase: string } | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(!(initialExpanded ?? false))
  const progressTimeoutRef = useRef<number | null>(null)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadingProgress(null)
    
    try {
      // Get current block number via RPC (with proxy fallback)
      const blockNumberHex = await rpcCall<string>('eth_blockNumber', [])
      const currentBlock = parseInt(blockNumberHex, 16)
      
      // Calculate block range
      const blocksPerDay = 2880
      const blockRange = blocksPerDay * days
      const fromBlock = Math.max(0, currentBlock - blockRange)
      
      // Transfer event signature
      const transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      const zeroAddressNormalized = ZERO_ADDRESS.toLowerCase()
      
      // Fetch Transfer events for both tokens and RIF collateral
      const [usdrifLogs, rifproLogs, rifLogs] = await Promise.all([
        fetchLogsV1(USDRIF_ADDRESS.toLowerCase(), fromBlock, currentBlock, transferEventTopic),
        fetchLogsV1(RIFPRO_ADDRESS.toLowerCase(), fromBlock, currentBlock, transferEventTopic),
        fetchLogsV1(RIF_TOKEN_ADDRESS.toLowerCase(), fromBlock, currentBlock, transferEventTopic),
      ])
      
      // Process events first to get transaction hashes
      const allEvents: Array<{
        log: BlockscoutLog
        tokenType: 'USDRIF' | 'RifPro'
        from: string
        to: string
        value: bigint
        direction: 'MINT' | 'REDEEM'
      }> = []
      
      // Process USDRIF events
      for (const log of usdrifLogs) {
        if (log.topics.length < 3) continue
        
        const fromTopic = log.topics[1]
        const toTopic = log.topics[2]
        const fromAddr = '0x' + fromTopic.slice(-40).toLowerCase()
        const toAddr = '0x' + toTopic.slice(-40).toLowerCase()
        const value = BigInt(log.data || '0x0')
        
        const fromChecksummed = fromAddr.toLowerCase()
        const toChecksummed = toAddr.toLowerCase()
        
        if (fromChecksummed === zeroAddressNormalized && toChecksummed !== zeroAddressNormalized) {
          allEvents.push({ log, tokenType: 'USDRIF', from: fromChecksummed, to: toChecksummed, value, direction: 'MINT' })
        } else if (toChecksummed === zeroAddressNormalized && fromChecksummed !== zeroAddressNormalized) {
          allEvents.push({ log, tokenType: 'USDRIF', from: fromChecksummed, to: toChecksummed, value, direction: 'REDEEM' })
        }
      }
      
      // Process RifPro events
      for (const log of rifproLogs) {
        if (log.topics.length < 3) continue
        
        const fromTopic = log.topics[1]
        const toTopic = log.topics[2]
        const fromAddr = '0x' + fromTopic.slice(-40).toLowerCase()
        const toAddr = '0x' + toTopic.slice(-40).toLowerCase()
        const value = BigInt(log.data || '0x0')
        
        const fromChecksummed = fromAddr.toLowerCase()
        const toChecksummed = toAddr.toLowerCase()
        
        if (fromChecksummed === zeroAddressNormalized && toChecksummed !== zeroAddressNormalized) {
          allEvents.push({ log, tokenType: 'RifPro', from: fromChecksummed, to: toChecksummed, value, direction: 'MINT' })
        } else if (toChecksummed === zeroAddressNormalized && fromChecksummed !== zeroAddressNormalized) {
          allEvents.push({ log, tokenType: 'RifPro', from: fromChecksummed, to: toChecksummed, value, direction: 'REDEEM' })
        }
      }
      
      // Get unique transaction hashes for all mint/redeem events
      const uniqueTxHashes = [...new Set(allEvents.map(e => e.log.transactionHash))]
      
      // Set total count for progress tracking
      const totalTxs = uniqueTxHashes.length
      if (totalTxs > 0) {
        setLoadingProgress({ current: 0, total: totalTxs, phase: `Fetch RoC events... ${ROC_CONTRACTS_LABEL}` })
      }
      
      // Now fetch MoC events - query by transaction hash from Blockscout API
      const mocInterface = new ethers.Interface(MOC_ABI)
      const mintEvent = mocInterface.getEvent('MintStableToken')
      const mintVendorsEvent = mocInterface.getEvent('MintStableTokenVendors')
      const redeemEvent = mocInterface.getEvent('RedeemFreeStableToken')
      const redeemVendorsEvent = mocInterface.getEvent('RedeemFreeStableTokenVendors')
      
      if (!mintEvent || !mintVendorsEvent || !redeemEvent || !redeemVendorsEvent) {
        throw new Error('Failed to get MoC event definitions')
      }
      
      const mintEventTopic = mintEvent.topicHash
      const mintVendorsEventTopic = mintVendorsEvent.topicHash
      const redeemEventTopic = redeemEvent.topicHash
      const redeemVendorsEventTopic = redeemVendorsEvent.topicHash
      
      console.log(`[DEBUG] Event topic hashes:`, {
        mint: mintEventTopic,
        mintVendors: mintVendorsEventTopic,
        redeem: redeemEventTopic,
        redeemVendors: redeemVendorsEventTopic,
      })
      
      // Query MoC events from all known contract addresses
      const mocEvents: Array<{ log: BlockscoutLog; contractAddress: string }> = []
      for (const mocAddress of MOC_CONTRACT_ADDRESSES) {
        const contractName = MOC_CONTRACT_NAMES[mocAddress.toLowerCase()] || 'MoC'
        if (totalTxs > 0) {
          setLoadingProgress(prev => prev ? { ...prev, phase: `Fetch RoC events... ${contractName}` } : null)
        }
        console.log(`[DEBUG] Querying MoC events from ${mocAddress}...`)
        const [mintEvents, mintVendorsEvents, redeemEvents, redeemVendorsEvents] = await Promise.all([
          fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, mintEventTopic),
          fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, mintVendorsEventTopic),
          fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, redeemEventTopic),
          fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, redeemVendorsEventTopic),
        ])
        
        console.log(`[DEBUG] Found events from ${mocAddress}:`, {
          mint: mintEvents.length,
          mintVendors: mintVendorsEvents.length,
          redeem: redeemEvents.length,
          redeemVendors: redeemVendorsEvents.length,
        })
        
        mintEvents.forEach(e => mocEvents.push({ log: e, contractAddress: mocAddress.toLowerCase() }))
        mintVendorsEvents.forEach(e => mocEvents.push({ log: e, contractAddress: mocAddress.toLowerCase() }))
        redeemEvents.forEach(e => mocEvents.push({ log: e, contractAddress: mocAddress.toLowerCase() }))
        redeemVendorsEvents.forEach(e => mocEvents.push({ log: e, contractAddress: mocAddress.toLowerCase() }))
      }
      
      // Also query MoC events by transaction hash (in case events are emitted from different contracts)
      // Batch requests to avoid rate limiting
      console.log(`[DEBUG] Querying MoC events for ${uniqueTxHashes.length} unique transaction hashes...`)
      
      const BATCH_SIZE = 5 // Smaller batches to avoid rate limiting
      const BATCH_DELAY = 200 // 200ms delay between batches
      
      // Query transaction logs in batches with delays
      const mocQueryLimit = Math.min(uniqueTxHashes.length, 50)
      for (let i = 0; i < mocQueryLimit; i += BATCH_SIZE) {
        const batch = uniqueTxHashes.slice(i, i + BATCH_SIZE)
        
        // Update progress (MoC events phase: ~25% of total work)
        if (totalTxs > 0) {
          const progress = Math.floor(((i + BATCH_SIZE) / mocQueryLimit) * 25)
          setLoadingProgress({ current: Math.min(progress, 25), total: 100, phase: `Fetch RoC events... ${ROC_CONTRACTS_LABEL} (${Math.min(i + BATCH_SIZE, mocQueryLimit)}/${mocQueryLimit})` })
        }
        
        // Process batch in parallel
        const batchPromises = batch.map(async (txHash) => {
          try {
            // Use transaction info endpoint (more reliable than proxy)
            const txLogsUrl = `${BLOCKSCOUT_API}?module=transaction&action=gettxinfo&txhash=${txHash}`
            const txLogsResponse = await fetch(txLogsUrl)
            
            if (!txLogsResponse.ok) {
              if (txLogsResponse.status === 400 || txLogsResponse.status === 429) {
                // Rate limited or bad request - skip
                return null
              }
              return null
            }
            
            const txLogsData = await txLogsResponse.json()
            const logs = txLogsData.result?.logs || txLogsData.result?.receipt?.logs || []
            
            if (logs && logs.length > 0) {
              // Check if any logs match MoC event topics
              for (const logEntry of logs) {
                if (logEntry.topics && logEntry.topics[0]) {
                  const eventTopic = logEntry.topics[0]
                  if (eventTopic === mintEventTopic || 
                      eventTopic === mintVendorsEventTopic || 
                      eventTopic === redeemEventTopic || 
                      eventTopic === redeemVendorsEventTopic) {
                    // Found a MoC event! Add it
                    return {
                      log: {
                        address: logEntry.address,
                        topics: logEntry.topics,
                        data: logEntry.data,
                        blockNumber: logEntry.blockNumber || txLogsData.result?.blockNumber || '0x0',
                        transactionHash: txHash,
                        blockHash: logEntry.blockHash || txLogsData.result?.blockHash || '0x0',
                        logIndex: logEntry.logIndex || logEntry.index || '0x0',
                        removed: false,
                      }, 
                      contractAddress: logEntry.address.toLowerCase() 
                    }
                  }
                }
              }
            }
            return null
          } catch (error) {
            // Ignore errors for individual transaction queries
            return null
          }
        })
        
        const batchResults = await Promise.all(batchPromises)
        for (const result of batchResults) {
          if (result) {
            mocEvents.push(result)
          }
        }
        
        // Add delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < Math.min(uniqueTxHashes.length, 50)) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
        }
      }
      
      console.log(`[DEBUG] Found ${mocEvents.length} total MoC events to process`)
      
      // Update progress: MoC events complete (25%), moving to block timestamps
      if (totalTxs > 0) {
        setLoadingProgress({ current: 25, total: 100, phase: 'Fetching block timestamps...' })
      }
      
      // Group MoC events by transaction hash and extract account addresses
      const mocEventsByTx = new Map<string, Array<{ log: BlockscoutLog; decoded: any }>>()
      const accountByTx = new Map<string, string>() // Map transaction hash to end user account
      
      for (const { log } of mocEvents) {
        try {
          const decoded = mocInterface.parseLog({
            topics: log.topics,
            data: log.data,
          })
          
          // Extract account address from MoC events
          // For events like MintStableToken(address indexed account, ...):
          // - topics[0] = event signature hash
          // - topics[1] = account (indexed address, padded to 32 bytes = 66 chars with 0x)
          // - topics[2] = vendorAccount (indexed, if present)
          let accountAddress: string | null = null
          
          // Method 1: Extract from topics[1] directly (most reliable for indexed params)
          // Indexed addresses are padded to 32 bytes (64 hex chars), extract last 40 chars
          if (log.topics.length > 1) {
            const accountTopic = log.topics[1]
            if (accountTopic && accountTopic.startsWith('0x') && accountTopic.length === 66) {
              // Extract last 40 hex characters (20 bytes = address)
              accountAddress = '0x' + accountTopic.slice(-40).toLowerCase()
            }
          }
          
          // Method 2: Try from decoded args (ethers.js should decode correctly)
          if (decoded && (!accountAddress || accountAddress === ZERO_ADDRESS) && decoded.args && decoded.args.length > 0) {
            try {
              const arg0 = decoded.args[0]
              if (arg0) {
                // Handle different return types from ethers.js
                let argStr: string
                if (typeof arg0 === 'string') {
                  argStr = arg0
                } else if (typeof arg0 === 'object' && arg0 !== null) {
                  // Check if it's an ethers Addressable or similar
                  if ('toString' in arg0 && typeof arg0.toString === 'function') {
                    argStr = arg0.toString()
                  } else if ('toLowerCase' in arg0 && typeof arg0.toLowerCase === 'function') {
                    argStr = String(arg0)
                  } else {
                    argStr = String(arg0)
                  }
                } else {
                  argStr = String(arg0)
                }
                
                // Normalize address format
                if (argStr.startsWith('0x') && argStr.length === 42) {
                  accountAddress = argStr.toLowerCase()
                } else if (!argStr.startsWith('0x') && argStr.length === 40) {
                  accountAddress = '0x' + argStr.toLowerCase()
                }
              }
            } catch (e) {
              // Ignore errors, continue with topics extraction
            }
          }
          
          // Store account address for this transaction
          if (decoded && accountAddress && accountAddress !== ZERO_ADDRESS && accountAddress.length === 42) {
            // Use the first account found for this transaction (should be consistent)
            if (!accountByTx.has(log.transactionHash)) {
              accountByTx.set(log.transactionHash, accountAddress)
              // Debug: log first few extractions
              if (accountByTx.size <= 5) {
                console.log(`[DEBUG] Extracted account ${accountAddress} from ${decoded.name} event for tx ${log.transactionHash.substring(0, 10)}...`)
              }
            }
          } else {
            // Debug: log if extraction failed
            if (decoded && mocEvents.length <= 5) {
              console.warn(`[DEBUG] Failed to extract account from ${decoded.name} event:`, {
                topicsLength: log.topics.length,
                topics1: log.topics[1]?.substring(0, 20),
                argsLength: decoded.args?.length,
                arg0: decoded.args?.[0],
              })
            }
          }
          
          if (!mocEventsByTx.has(log.transactionHash)) {
            mocEventsByTx.set(log.transactionHash, [])
          }
          mocEventsByTx.get(log.transactionHash)!.push({ log, decoded })
        } catch (error) {
          // Log decode errors for debugging
          if (mocEvents.length <= 5) {
            console.warn(`[DEBUG] Failed to decode MoC event:`, error)
          }
          continue
        }
      }
      
      // Group RIF transfers by transaction hash
      const rifTransfersByTx = new Map<string, Array<{ from: string; to: string; value: bigint }>>()
      const mocCoreAddressLower = MOC_V2_CORE.toLowerCase()
      for (const log of rifLogs) {
        if (log.topics.length < 3) continue
        
        const fromTopic = log.topics[1]
        const toTopic = log.topics[2]
        const fromAddr = '0x' + fromTopic.slice(-40).toLowerCase()
        const toAddr = '0x' + toTopic.slice(-40).toLowerCase()
        const value = BigInt(log.data || '0x0')
        
        if (!rifTransfersByTx.has(log.transactionHash)) {
          rifTransfersByTx.set(log.transactionHash, [])
        }
        rifTransfersByTx.get(log.transactionHash)!.push({
          from: fromAddr,
          to: toAddr,
          value,
        })
      }
      
      
      // Fetch block timestamps in smaller batches with delays to avoid rate limiting
      const uniqueBlockNumbers = [...new Set(allEvents.map(e => parseInt(e.log.blockNumber, 16)))].sort((a, b) => a - b)
      const blockTimestamps = new Map<number, Date>()
      
      const BLOCK_BATCH_SIZE = 5 // Smaller batches
      const BLOCK_BATCH_DELAY = 100 // 100ms delay between batches
      
      // Fetch blocks in batches with delays
      const totalBlocks = uniqueBlockNumbers.length
      for (let i = 0; i < uniqueBlockNumbers.length; i += BLOCK_BATCH_SIZE) {
        const batch = uniqueBlockNumbers.slice(i, i + BLOCK_BATCH_SIZE)
        
        // Update progress (blocks are ~25% of total work: 25-50%)
        if (totalTxs > 0) {
          const blockProgress = 25 + Math.floor((i / totalBlocks) * 25)
          setLoadingProgress({ current: Math.min(blockProgress, 50), total: 100, phase: `Fetching block timestamps... (${Math.min(i + BLOCK_BATCH_SIZE, totalBlocks)}/${totalBlocks} blocks)` })
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
            // Silently handle errors to avoid spam
            return null
          }
        })
        
        const results = await Promise.all(blockPromises)
        for (const result of results) {
          if (result) {
            blockTimestamps.set(result.blockNum, new Date(result.timestamp * 1000))
          }
        }
        
        // Add delay between batches to avoid rate limiting
        if (i + BLOCK_BATCH_SIZE < uniqueBlockNumbers.length) {
          await new Promise(resolve => setTimeout(resolve, BLOCK_BATCH_DELAY))
        }
      }
      
      // Update progress: Block timestamps complete (50%), moving to transaction details
      if (totalTxs > 0) {
        setLoadingProgress({ current: 50, total: 100, phase: 'Fetching transaction details...' })
      }
      
      // Fetch transaction details to get original sender (fallback if no MoC event)
      const txFromByHash = new Map<string, string>()
      const txToByHash = new Map<string, string>() // Store 'to' address to check if it's a contract
      
      // Fetch transaction details in smaller batches with delays to avoid rate limiting
      const TX_BATCH_SIZE = 5 // Smaller batches
      const TX_BATCH_DELAY = 150 // 150ms delay between batches
      
      const txDetailsLimit = Math.min(uniqueTxHashes.length, 100)
      for (let i = 0; i < txDetailsLimit; i += TX_BATCH_SIZE) {
        const batch = uniqueTxHashes.slice(i, i + TX_BATCH_SIZE)
        
        // Update progress (transaction details are ~25% of total work: 50-75%)
        if (totalTxs > 0) {
          const txProgress = 50 + Math.floor((i / txDetailsLimit) * 25)
          setLoadingProgress({ current: Math.min(txProgress, 75), total: 100, phase: `Fetching transaction details... (${Math.min(i + TX_BATCH_SIZE, txDetailsLimit)}/${txDetailsLimit})` })
        }
        
        const txPromises = batch.map(async (txHash) => {
          try {
            // Try Blockscout transaction info endpoint first (more reliable)
            const txInfoUrl = `${BLOCKSCOUT_API}?module=transaction&action=gettxinfo&txhash=${txHash}`
            const txInfoResponse = await fetch(txInfoUrl)
            
            if (txInfoResponse.ok) {
              const txInfoData = await txInfoResponse.json()
              if (txInfoData.status === '1' && txInfoData.result) {
                return {
                  txHash,
                  from: txInfoData.result.from ? txInfoData.result.from.toLowerCase() : null,
                  to: txInfoData.result.to ? txInfoData.result.to.toLowerCase() : null,
                }
              }
            }
            
            // Fallback to RPC call
            const txData = await rpcCall<{ from?: string; to?: string }>('eth_getTransactionByHash', [txHash])
            if (txData) {
              return {
                txHash,
                from: txData.from ? txData.from.toLowerCase() : null,
                to: txData.to ? txData.to.toLowerCase() : null,
              }
            }
            return null
          } catch {
            return null
          }
        })
        
        const results = await Promise.all(txPromises)
        for (const result of results) {
          if (result) {
            if (result.from) {
              txFromByHash.set(result.txHash, result.from)
            }
            if (result.to) {
              txToByHash.set(result.txHash, result.to)
            }
          }
        }
        
        // Add delay between batches to avoid rate limiting
        if (i + TX_BATCH_SIZE < txDetailsLimit) {
          await new Promise(resolve => setTimeout(resolve, TX_BATCH_DELAY))
        }
      }
      
      console.log(`[DEBUG] Fetched ${txFromByHash.size} transaction 'from' addresses`)
      
      // Update progress: Transaction details complete (75%), building transaction list
      if (totalTxs > 0) {
        setLoadingProgress({ current: 75, total: 100, phase: 'Processing transactions...' })
      }
      
      // Build transaction list with collateral extraction
      const txs: MintRedeemTransaction[] = []
      let processedCount = 0
      for (const { log, tokenType, from, to, value, direction } of allEvents) {
        processedCount++
        // Update progress during processing (last 25% of work: 75-100%)
        if (totalTxs > 0 && (processedCount % 10 === 0 || processedCount === allEvents.length)) {
          const processingProgress = 75 + Math.floor((processedCount / allEvents.length) * 25)
          setLoadingProgress({ current: Math.min(processingProgress, 100), total: 100, phase: `Processing transactions... (${processedCount}/${allEvents.length})` })
        }
        const blockNumber = parseInt(log.blockNumber, 16)
        const timestamp = blockTimestamps.get(blockNumber)
        if (!timestamp) continue
        
        const type = `${tokenType} ${direction === 'MINT' ? 'Mint' : 'Redeem'}` as MintRedeemTransaction['type']
        
        // Determine receiver using multi-tier approach based on transaction flow analysis:
        // 
        // BUSINESS FLOW FOR REDEEMS:
        // 1. User initiates redeem (USDRIF burn happens in separate/previous TX)
        // 2. Queue contract (0x8d7c61...) processes the request
        // 3. Queue calls MoC contract
        // 4. MoC V2 Core transfers RIF to end user (largest transfer to non-contract)
        //
        // Priority 1) MoC event account (most reliable, if available)
        // Priority 2) RIF transfer recipient/sender (identifies actual end user, not queue contract)
        //    - For REDEEM: Largest RIF transfer TO a non-contract address
        //    - For MINT: Largest RIF transfer FROM a non-contract address
        // Priority 3) Transaction from address (fallback, but often queue contract)
        // Priority 4) Transfer event address (least reliable)
        
        let receiver = accountByTx.get(log.transactionHash)
        const txFrom = txFromByHash.get(log.transactionHash)
        const txTo = txToByHash.get(log.transactionHash)
        const transferEventAddr = direction === 'MINT' ? to : from
        
        // Known contract addresses (not end users) - based on transaction flow analysis
        const queueContract = '0x8d7c61aab2db42739560682a4f949765ce48feaa'
        const mocV2Core = '0xa27024ed70035e46dba712609fc2afa1c97aa36a'
        const knownContracts = new Set([
          txFrom || '',
          txTo || '',
          USDRIF_ADDRESS.toLowerCase(),
          RIFPRO_ADDRESS.toLowerCase(),
          RIF_TOKEN_ADDRESS.toLowerCase(),
          MOC_V2_CORE.toLowerCase(),
          mocV2Core.toLowerCase(),
          '0xf773b590af754d597770937fa8ea7abd2668370', // MoC contract
          '0xb9c42efc8ec54490a37ca91c423f7285fa01e257', // MoC State
          queueContract.toLowerCase(), // Queue contract (MoCQueue)
          '0x9181e99dceace7dfd5f2e7d5126275d54067a9e3', // MoC Commons contract
          '0x9c66296938d849802ffa879a20fdc11b58c55851', // Fee recipient 1
          '0xc61820bfb8f87391d62cd3976ddc1d35e0cf7128', // Fee recipient 2
        ].filter(Boolean).map(addr => addr.toLowerCase()))
        
        // Strategy 2: Derive from RIF transfers (identifies actual end user)
        // This is the most reliable method based on transaction flow analysis
        if (!receiver) {
          const rifTransfers = rifTransfersByTx.get(log.transactionHash) || []
          
          if (direction === 'REDEEM' && rifTransfers.length > 0) {
            // For redeems: RIF is transferred TO the user from MoC V2 Core
            // Find the largest RIF transfer to a non-contract address
            // The largest transfer is typically the main user, smaller ones are fees
            const sortedRifTransfers = [...rifTransfers]
              .filter(rifTx => {
                const recipient = rifTx.to.toLowerCase()
                return !knownContracts.has(recipient) && rifTx.value > 0n
              })
              .sort((a, b) => {
                return a.value > b.value ? -1 : a.value < b.value ? 1 : 0
              })
            
            if (sortedRifTransfers.length > 0) {
              receiver = sortedRifTransfers[0].to.toLowerCase()
            }
          } else if (direction === 'MINT' && rifTransfers.length > 0) {
            // For mints: RIF is transferred FROM the user TO MoC V2 Core
            // Find the largest RIF transfer from a non-contract address
            const sortedRifTransfers = [...rifTransfers]
              .filter(rifTx => {
                const sender = rifTx.from.toLowerCase()
                return !knownContracts.has(sender) && rifTx.value > 0n
              })
              .sort((a, b) => {
                return a.value > b.value ? -1 : a.value < b.value ? 1 : 0
              })
            
            if (sortedRifTransfers.length > 0) {
              receiver = sortedRifTransfers[0].from.toLowerCase()
            }
          }
        }
        
        // Strategy 3: Fallback to transaction from address (but check if it's a known contract)
        if (!receiver) {
          if (txFrom && !knownContracts.has(txFrom)) {
            receiver = txFrom
          } else {
            receiver = transferEventAddr
          }
        }
        
        // Debug: Log receiver determination for first few transactions
        if (txs.length < 5) {
          const mocAccount = accountByTx.get(log.transactionHash)
          const rifTransfers = rifTransfersByTx.get(log.transactionHash) || []
          const rifTransferAnalysis = rifTransfers.length > 0 ? {
            totalRifTransfers: rifTransfers.length,
            rifRecipients: [...new Set(rifTransfers.map(t => t.to.toLowerCase()))],
            rifSenders: [...new Set(rifTransfers.map(t => t.from.toLowerCase()))],
            largestRifTransfer: rifTransfers.reduce((max, t) => t.value > max.value ? t : max, rifTransfers[0]),
          } : null
          
          console.log(`[DEBUG] Receiver determination for tx ${log.transactionHash.substring(0, 10)}...:`, {
            accountFromMoC: mocAccount || 'NOT FOUND',
            txFrom: txFrom || 'NOT FOUND',
            transferEvent: transferEventAddr,
            finalReceiver: receiver,
            hasMoCEvent: mocEventsByTx.has(log.transactionHash),
            mocEventCount: mocEventsByTx.get(log.transactionHash)?.length || 0,
            rifTransferAnalysis,
            derivationMethod: mocAccount ? 'MoC_EVENT' : (rifTransfers.length > 0 ? 'RIF_TRANSFER' : (txFrom ? 'TX_FROM' : 'TRANSFER_EVENT')),
          })
        }
        
        // Extract collateral amount using three-tier approach:
        // 1. MoC contract events (most reliable)
        // 2. RIF Transfer events (fallback)
        let collateralAmount = 0n
        let tokenReturnedAddr = ZERO_ADDRESS
        
        // Method 1: Check MoC contract events
        const mocTxEvents = mocEventsByTx.get(log.transactionHash) || []
        for (const { decoded } of mocTxEvents) {
          if (!decoded) continue
          
          if (decoded.name === 'MintStableToken' || decoded.name === 'MintStableTokenVendors') {
            // reserveTokenAmount is the RIF collateral amount (args[1])
            if (decoded.args && decoded.args.length > 1) {
              const reserveTokenAmount = decoded.args[1] as bigint
              if (reserveTokenAmount > collateralAmount) {
                collateralAmount = reserveTokenAmount
              }
            }
          } else if (decoded.name === 'RedeemFreeStableToken' || decoded.name === 'RedeemFreeStableTokenVendors') {
            // reserveTokenAmount is the RIF returned (args[2])
            if (decoded.args && decoded.args.length > 2) {
              const reserveTokenAmount = decoded.args[2] as bigint
              if (reserveTokenAmount > collateralAmount) {
                collateralAmount = reserveTokenAmount
                tokenReturnedAddr = RIF_TOKEN_ADDRESS
              }
            }
          }
        }
        
        // Method 2: Fallback to RIF Transfer events
        if (collateralAmount === 0n) {
          const rifTransfers = rifTransfersByTx.get(log.transactionHash) || []
          
          if (direction === 'MINT') {
            // For mints: Sum all RIF transfers TO MoC contract (collateral being locked)
            for (const rifTx of rifTransfers) {
              if (rifTx.to.toLowerCase() === mocCoreAddressLower) {
                collateralAmount += rifTx.value
              }
            }
          } else {
            // For redeems: MoC returns RIF collateral TO the user
            for (const rifTx of rifTransfers) {
              if (rifTx.from.toLowerCase() === mocCoreAddressLower && 
                  rifTx.to.toLowerCase() === from.toLowerCase()) {
                collateralAmount += rifTx.value
                tokenReturnedAddr = RIF_TOKEN_ADDRESS
              }
            }
          }
        }
        
        const amountSentReceived = formatAmount(collateralAmount, 18)
        const returned = direction === 'REDEEM'
        const valueReturned = direction === 'REDEEM' ? amountSentReceived : '0'
        
        txs.push({
          time: timestamp,
          hash: log.transactionHash,
          status: 'Success', // Assume success if event was emitted
          type,
          amountMintedRedeemed: formatAmount(value, 18),
          receiver,
          amountSentReceived,
          returned,
          valueReturned,
          tokenReturned: tokenReturnedAddr,
          blockNumber,
        })
      }
      
      // Sort by timestamp (newest first) and filter to requested period
      txs.sort((a, b) => b.time.getTime() - a.time.getTime())
      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000)
      const recentTxs = txs.filter(tx => tx.time.getTime() >= cutoffTime)
      
      setTransactions(recentTxs)
      setLastUpdated(new Date())
      if (totalTxs > 0) {
        setLoadingProgress({ current: 100, total: 100, phase: 'Complete' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions')
      console.error('Error fetching mint/redeem transactions:', err)
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

  const exportToExcel = useCallback((txsToExport: MintRedeemTransaction[]) => {
    try {
      // Create workbook
      const wb = XLSX.utils.book_new()

      // Prepare data for Excel with full precision amounts
      const excelData = txsToExport.map(tx => ({
        'Time (UTC)': tx.time.toISOString().replace('T', ' ').substring(0, 19),
        'TX Hash': tx.hash, // Will be converted to HYPERLINK formula below
        'Status': tx.status,
        'Asset': tx.type.includes('USDRIF') ? 'USDRIF' : 'RifPro',
        'Type': tx.type.includes('Mint') ? 'Mint' : 'Redeem',
        'Amount Minted/Redeemed': tx.amountMintedRedeemed, // Full precision value
        'Receiver': tx.receiver,
        'Block Number': tx.blockNumber,
      }))

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(excelData)

      // Convert TX Hash column to HYPERLINK formulas
      // Find the column index for 'TX Hash' (should be column B, index 1)
      const txHashColIndex = 1 // Column B (0-indexed: A=0, B=1)
      const txHashColLetter = XLSX.utils.encode_col(txHashColIndex)
      
      // Update each TX Hash cell to use HYPERLINK formula
      // Row 1 is header, so data starts at row 2 (1-indexed in Excel)
      for (let i = 0; i < txsToExport.length; i++) {
        const rowIndex = i + 2 // Excel rows are 1-indexed, row 1 is header
        const tx = txsToExport[i]
        const cellAddress = `${txHashColLetter}${rowIndex}`
        const url = `https://rootstock.blockscout.com/tx/${tx.hash}`
        const displayText = tx.hash.substring(0, 10) + '...' + tx.hash.substring(tx.hash.length - 8)
        
        // Set cell to HYPERLINK formula
        ws[cellAddress] = {
          t: 's', // string type
          f: `HYPERLINK("${url}","${displayText}")`, // Excel formula
        }
      }

      // Set column widths
      ws['!cols'] = [
        { wch: 20 }, // Time
        { wch: 25 }, // TX Hash (shortened display text with HYPERLINK)
        { wch: 12 }, // Status
        { wch: 12 }, // Asset
        { wch: 15 }, // Type
        { wch: 30 }, // Amount (full precision)
        { wch: 45 }, // Receiver
        { wch: 15 }, // Block Number
      ]

      // Add summary rows
      const summaryStartRow = excelData.length + 3
      const summaryData = [
        {},
        { 'Time (UTC)': 'Total Transactions:', 'Status': txsToExport.length },
        { 'Time (UTC)': 'Mints:', 'Status': txsToExport.filter(tx => tx.type.includes('Mint')).length },
        { 'Time (UTC)': 'Redeems:', 'Status': txsToExport.filter(tx => tx.type.includes('Redeem')).length },
      ]
      
      XLSX.utils.sheet_add_json(ws, summaryData, { origin: `A${summaryStartRow}`, skipHeader: true })

      // Add worksheet to workbook (sheet name cannot contain : \ / ? * [ ])
      const sheetName = 'USDRIF Mint Redeem Transactions'
      XLSX.utils.book_append_sheet(wb, ws, sheetName)

      const filename = generateDateFilename('usdrif_txs')
      writeExcelWorkbook(wb, filename)
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      alert('Failed to export to Excel. Please try again.')
    }
  }, [])

  const controls = (
    <>
      <div className="filter-toggle">
        <button
          className={`filter-button ${tokenFilter === 'All' ? 'active' : ''}`}
          onClick={() => setTokenFilter('All')}
          aria-pressed={tokenFilter === 'All'}
        >
          All
        </button>
        <button
          className={`filter-button ${tokenFilter === 'USDRIF' ? 'active' : ''}`}
          onClick={() => setTokenFilter('USDRIF')}
          aria-pressed={tokenFilter === 'USDRIF'}
        >
          USDRIF
        </button>
        <button
          className={`filter-button ${tokenFilter === 'RifPro' ? 'active' : ''}`}
          onClick={() => setTokenFilter('RifPro')}
          aria-pressed={tokenFilter === 'RifPro'}
        >
          RifPro
        </button>
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
          onClick={() =>
            exportToExcel(
              transactions.filter((tx) =>
                tokenFilter === 'All' ? true : tx.type.includes(tokenFilter)
              )
            )
          }
          disabled={loading}
        >
          XLS
        </button>
      </div>
    </>
  )

  const filteredTransactions =
    tokenFilter === 'All'
      ? transactions
      : transactions.filter((tx) => tx.type.includes(tokenFilter))

  const tableContent =
    filteredTransactions.length === 0 ? (
      <div className="no-data" role="status" aria-live="polite">
        No {tokenFilter === 'All' ? '' : tokenFilter + ' '}transactions found with the selected
        filter.
        <br />
        <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>
          Try selecting a different time period or filter option.
        </span>
      </div>
    ) : (
      <>
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
            {filteredTransactions.map((tx, idx) => (
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
                <td>{tx.type.includes('USDRIF') ? 'USDRIF' : 'RifPro'}</td>
                <td className={tx.type.includes('Mint') ? 'type-mint' : 'type-redeem'}>
                  {tx.type.includes('Mint') ? 'Mint' : 'Redeem'}
                </td>
                <td title={tx.amountMintedRedeemed}>
                  {formatAmountDisplay(tx.amountMintedRedeemed, 2)}
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
              Total Transactions: {filteredTransactions.length}
              {tokenFilter !== 'All' && ` (filtered from ${transactions.length})`}, Mints:{' '}
              {filteredTransactions.filter((tx) => tx.type.includes('Mint')).length} | Redeems:{' '}
              {filteredTransactions.filter((tx) => tx.type.includes('Redeem')).length}
              {tokenFilter === 'All' && (
                <>
                  , USDRIF: {filteredTransactions.filter((tx) => tx.type.includes('USDRIF')).length}{' '}
                  | RifPro: {filteredTransactions.filter((tx) => tx.type.includes('RifPro')).length}
                </>
              )}
              {(() => {
                const usdrifTotal = filteredTransactions
                  .filter((tx) => tx.type.includes('USDRIF'))
                  .reduce((sum, tx) => sum + parseFloat(tx.amountMintedRedeemed || '0'), 0)
                const rifproTotal = filteredTransactions
                  .filter((tx) => tx.type.includes('RifPro'))
                  .reduce((sum, tx) => sum + parseFloat(tx.amountMintedRedeemed || '0'), 0)
                return (
                  <>
                    , USDRIF total: {formatAmountDisplay(usdrifTotal.toString(), 0)} | RIFPRO total:{' '}
                    {formatAmountDisplay(rifproTotal.toString(), 0)}
                  </>
                )
              })()}
            </p>
            {lastUpdated && (
              <p className="last-updated">
                Last updated: {lastUpdated.getFullYear()}
                {String(lastUpdated.getMonth() + 1).padStart(2, '0')}
                {String(lastUpdated.getDate()).padStart(2, '0')} {String(lastUpdated.getHours()).padStart(2, '0')}:
                {String(lastUpdated.getMinutes()).padStart(2, '0')}:
                {String(lastUpdated.getSeconds()).padStart(2, '0')}.
                {String(Math.floor(lastUpdated.getMilliseconds() / 10)).padStart(2, '0')}
              </p>
            )}
          </div>
        </div>
      </>
    )

  return (
    <AnalyserShell
      title="USDRIF"
      networkBadge="mainnet"
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      controls={controls}
      error={error}
      loading={loading}
      loadingProgress={loadingProgress}
      isEmpty={transactions.length === 0}
      emptyMessage="No mint/redeem transactions found in the selected period."
    >
      <div className="transactions-table-container">{tableContent}</div>
    </AnalyserShell>
  )
}
