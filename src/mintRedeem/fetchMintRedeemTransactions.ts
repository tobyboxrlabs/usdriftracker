/**
 * Pure async pipeline: RPC + Blockscout → mint/redeem transaction rows for the Analytics UI.
 */
import { ethers } from 'ethers'
import { fetchLogsV1, type BlockscoutLog } from '../api/blockscout'
import { formatAmount } from '../utils/amount'
import { logger } from '../utils/logger'
import { rpcCall } from '../utils/rpc'
import {
  BLOCKSCOUT_API_V1,
  BLOCKS_PER_DAY,
  MOC_ABI,
  MOC_CONTRACT_ADDRESSES,
  MOC_CONTRACT_NAMES,
  MOC_V2_CORE,
  RIF_TOKEN_ADDRESS,
  RIFPRO_ADDRESS,
  ROC_CONTRACTS_LABEL,
  TRANSFER_EVENT_TOPIC,
  USDRIF_ADDRESS,
  ZERO_ADDRESS,
} from './constants'
import type { MintRedeemTransaction } from './types'

export type MintRedeemProgress = { current: number; total: number; phase: string }

export async function fetchMintRedeemTransactions(
  days: number,
  onProgress?: (p: MintRedeemProgress | null) => void
): Promise<{
  recentTxs: MintRedeemTransaction[]
  fromBlock: number
  currentBlock: number
}> {
  let lastProgress: MintRedeemProgress | null = null
  const emitProgress = (p: MintRedeemProgress | null) => {
    lastProgress = p
    onProgress?.(p)
  }
  const emitProgressPhase = (phase: string) => {
    if (lastProgress) emitProgress({ ...lastProgress, phase })
  }

    // Get current block number via RPC (with proxy fallback)
    const blockNumberHex = await rpcCall<string>('eth_blockNumber', [])
    const currentBlock = parseInt(blockNumberHex, 16)
    
    // Calculate block range
    const blockRange = BLOCKS_PER_DAY * days
    const fromBlock = Math.max(0, currentBlock - blockRange)
    
    // Transfer event signature
    const transferEventTopic = TRANSFER_EVENT_TOPIC
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
      emitProgress({ current: 0, total: totalTxs, phase: `Fetch RoC events... ${ROC_CONTRACTS_LABEL}` })
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
    
    logger.mintRedeem.debug('Event topic hashes:', {
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
        emitProgressPhase(`Fetch RoC events... ${contractName}`)
      }
      logger.mintRedeem.debug(`Querying MoC events from ${mocAddress}...`)
      const [mintEvents, mintVendorsEvents, redeemEvents, redeemVendorsEvents] = await Promise.all([
        fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, mintEventTopic),
        fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, mintVendorsEventTopic),
        fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, redeemEventTopic),
        fetchLogsV1(mocAddress.toLowerCase(), fromBlock, currentBlock, redeemVendorsEventTopic),
      ])
      
      logger.mintRedeem.debug(`Found events from ${mocAddress}:`, {
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
    logger.mintRedeem.debug(`Querying MoC events for ${uniqueTxHashes.length} unique tx hashes...`)
    
    const BATCH_SIZE = 5 // Smaller batches to avoid rate limiting
    const BATCH_DELAY = 200 // 200ms delay between batches
    
    for (let i = 0; i < uniqueTxHashes.length; i += BATCH_SIZE) {
      const batch = uniqueTxHashes.slice(i, i + BATCH_SIZE)
      
      // Update progress (MoC events phase: ~25% of total work)
      if (totalTxs > 0) {
        const progress = Math.floor(((i + BATCH_SIZE) / uniqueTxHashes.length) * 25)
        emitProgress({ current: Math.min(progress, 25), total: 100, phase: `Fetch RoC events... ${ROC_CONTRACTS_LABEL} (${Math.min(i + BATCH_SIZE, uniqueTxHashes.length)}/${uniqueTxHashes.length})` })
      }
      
      // Process batch in parallel
      const batchPromises = batch.map(async (txHash) => {
        try {
          // Use transaction info endpoint (more reliable than proxy)
          const txLogsUrl = `${BLOCKSCOUT_API_V1}?module=transaction&action=gettxinfo&txhash=${txHash}`
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
    
    logger.mintRedeem.debug(`Found ${mocEvents.length} total MoC events to process`)
    
    // Update progress: MoC events complete (25%), moving to block timestamps
    if (totalTxs > 0) {
      emitProgress({ current: 25, total: 100, phase: 'Fetching block timestamps...' })
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
              logger.mintRedeem.debug(`Extracted account ${accountAddress} from ${decoded.name} for tx ${log.transactionHash.substring(0, 10)}...`)
            }
          }
        } else {
          // Debug: log if extraction failed
          if (decoded && mocEvents.length <= 5) {
            logger.mintRedeem.warn(`Failed to extract account from ${decoded.name} event:`, {
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
          logger.mintRedeem.warn('Failed to decode MoC event:', error)
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
        const blockProgress = 25 + Math.floor((i / Math.max(totalBlocks, 1)) * 25)
        emitProgress({ current: Math.min(blockProgress, 50), total: 100, phase: `Fetching block timestamps... (${Math.min(i + BLOCK_BATCH_SIZE, totalBlocks)}/${totalBlocks} blocks)` })
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
      emitProgress({ current: 50, total: 100, phase: 'Fetching transaction details...' })
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
        emitProgress({ current: Math.min(txProgress, 75), total: 100, phase: `Fetching transaction details... (${Math.min(i + TX_BATCH_SIZE, txDetailsLimit)}/${txDetailsLimit})` })
      }
      
      const txPromises = batch.map(async (txHash) => {
        try {
          // Try Blockscout transaction info endpoint first (more reliable)
          const txInfoUrl = `${BLOCKSCOUT_API_V1}?module=transaction&action=gettxinfo&txhash=${txHash}`
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
    
    logger.mintRedeem.debug(`Fetched ${txFromByHash.size} transaction 'from' addresses`)
    
    // Update progress: Transaction details complete (75%), building transaction list
    if (totalTxs > 0) {
      emitProgress({ current: 75, total: 100, phase: 'Processing transactions...' })
    }
    
    // Build transaction list with collateral extraction
    const txs: MintRedeemTransaction[] = []
    let processedCount = 0
    for (const { log, tokenType, from, to, value, direction } of allEvents) {
      processedCount++
      // Update progress during processing (last 25% of work: 75-100%)
      if (totalTxs > 0 && (processedCount % 10 === 0 || processedCount === allEvents.length)) {
        const processingProgress = 75 + Math.floor((processedCount / allEvents.length) * 25)
        emitProgress({ current: Math.min(processingProgress, 100), total: 100, phase: `Processing transactions... (${processedCount}/${allEvents.length})` })
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
        
        logger.mintRedeem.debug(`Receiver determination for tx ${log.transactionHash.substring(0, 10)}...:`, {
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
    
    if (totalTxs > 0) {
      emitProgress({ current: 100, total: 100, phase: 'Complete' })
    }
    logger.mintRedeem.info(`Fetched ${recentTxs.length} mint/redeem txs (${days}d) | blocks ${fromBlock}–${currentBlock}`)

    return { recentTxs, fromBlock, currentBlock }
}
