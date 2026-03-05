#!/usr/bin/env node
/**
 * Track USDRIF and RifPro Mint/Redeem Transactions (Enhanced)
 * 
 * This script queries Transfer events from both USDRIF and RifPro contracts
 * to identify mint and redeem transactions, matching the format shown in
 * the "Mint/Redeem Executions On Queue" table.
 * 
 * Usage:
 *   npx tsx track-mint-redeem-enhanced.ts [days] [--csv]
 * 
 * Parameters:
 *   days (optional) - Number of days to look back (default: 7)
 *   --csv (optional) - Export results to CSV file
 * 
 * Examples:
 *   npx tsx track-mint-redeem-enhanced.ts        # Last 7 days (default)
 *   npx tsx track-mint-redeem-enhanced.ts 1      # Last 1 day
 *   npx tsx track-mint-redeem-enhanced.ts 30     # Last 30 days
 *   npx tsx track-mint-redeem-enhanced.ts 7 --csv  # Export to CSV
 *   npx tsx track-mint-redeem-enhanced.ts 7 -c     # Export to CSV (short form)
 * 
 * Environment Variables (optional):
 *   VITE_ROOTSTOCK_RPC - Rootstock RPC endpoint (default: https://public-node.rsk.co)
 *   VITE_USDRIF_ADDRESS - USDRIF contract address
 *   VITE_RIFPRO_ADDRESS - RifPro contract address
 * 
 * Note on Collateral Amounts:
 * The "Amount Sent/Received" column attempts to extract RIF collateral amounts
 * by matching RIF Transfer events with mint/redeem transactions. However, the
 * exact collateral amounts may require:
 * - Parsing transaction input data to decode function call parameters
 * - Querying MoC contract events (MintStableToken, RedeemStableToken)
 * - Accounting for collateral that may have been locked in previous transactions
 * 
 * Current implementation looks for:
 * - Mints: RIF transfers TO MoC contract (collateral lock)
 * - Redeems: RIF transfers FROM MoC contract TO user (collateral return)
 */

import { ethers } from 'ethers'
import * as fs from 'fs'
import * as path from 'path'

// Configuration
const ROOTSTOCK_RPC = process.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co'
const BLOCKSCOUT_API = 'https://rootstock.blockscout.com/api'
const USDRIF_ADDRESS = process.env.VITE_USDRIF_ADDRESS || '0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37'
const RIFPRO_ADDRESS = process.env.VITE_RIFPRO_ADDRESS || '0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61'
const RIF_TOKEN_ADDRESS = '0x2acc95758f8b5f583470ba265eb685a8f45fc9d5' // RIF token (collateral)
const MOC_V2_CORE = '0xA27024Ed70035E46dba712609fc2Afa1c97aA36A' // MoC V2 Core contract (receives/locks RIF collateral)
// MoC main contract - try multiple addresses as the protocol may use different contracts
const MOC_CONTRACT_ADDRESSES = [
  '0xf773B590aF754D597770937Fa8ea7AbDf2668370', // Mainnet MoC contract (from docs)
  '0xA27024Ed70035E46dba712609fc2Afa1c97aA36A', // MoC V2 Core
  '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257', // MoC State
]

// ERC20 Transfer event signature
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
] as const

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

// Zero address used for minting (from) and redeeming (to)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

interface EnhancedTransaction {
  time: Date
  hash: string
  status: 'Success' | 'Failed'
  type: 'USDRIF Mint' | 'USDRIF Redeem' | 'RifPro Mint' | 'RifPro Redeem'
  amountMintedRedeemed: string // Amount of USDRIF/RifPro
  receiver: string
  amountSentReceived: string // Amount of RIF collateral sent/received
  returned: boolean
  valueReturned: string
  tokenReturned: string // Token address returned (RIF for redeems)
  blockNumber: number
}

interface BlockscoutLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  blockHash: string
  logIndex: string
  removed: boolean
}

interface BlockscoutResponse {
  status: string
  message: string
  result: BlockscoutLog[]
}

interface BlockscoutTxResponse {
  status: string
  message: string
  result: {
    from: string
    to: string
    value: string
    gasUsed: string
    isError: string
    input: string
  }
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

// Delay function to avoid rate limiting
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchLogsFromBlockscout(
  address: string,
  fromBlock: number,
  toBlock: number,
  topic0: string
): Promise<BlockscoutLog[]> {
  await delay(200) // Rate limit protection
  
  const url = `${BLOCKSCOUT_API}?module=logs&action=getLogs&address=${address}&fromBlock=${fromBlock}&toBlock=${toBlock}&topic0=${topic0}&page=1&offset=10000`
  
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Blockscout API error: ${response.status} ${response.statusText}`)
  }
  
  const data = (await response.json()) as BlockscoutResponse
  if (data.status !== '1') {
    return [] // No logs found
  }
  
  return data.result || []
}

async function fetchTransactionFromBlockscout(txHash: string): Promise<BlockscoutTxResponse['result'] | null> {
  await delay(200) // Rate limit protection
  
  const url = `${BLOCKSCOUT_API}?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}`
  
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    
    const data = await response.json()
    if (data.status !== '1' || !data.result) return null
    
    return data.result
  } catch {
    return null
  }
}

async function fetchMoCEventsFromBlockscout(
  contractAddress: string,
  fromBlock: number,
  toBlock: number,
  topic0: string
): Promise<BlockscoutLog[]> {
  await delay(200) // Rate limit protection
  
  const url = `${BLOCKSCOUT_API}?module=logs&action=getLogs&address=${contractAddress}&fromBlock=${fromBlock}&toBlock=${toBlock}&topic0=${topic0}&page=1&offset=10000`
  
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    
    const data = (await response.json()) as BlockscoutResponse
    if (data.status !== '1') return []
    
    return data.result || []
  } catch {
    return []
  }
}

function decodeTransactionInput(input: string, contractInterface: ethers.Interface): {
  functionName: string | null
  args: any[] | null
} {
  try {
    if (!input || input === '0x') return { functionName: null, args: null }
    const decoded = contractInterface.parseTransaction({ data: input })
    return {
      functionName: decoded.name,
      args: decoded.args as any[],
    }
  } catch {
    return { functionName: null, args: null }
  }
}

async function getChecksummedAddress(address: string): Promise<string> {
  try {
    return ethers.getAddress(address)
  } catch {
    return ethers.getAddress(address.toLowerCase())
  }
}

function formatTable(transactions: EnhancedTransaction[], daysToQuery: number): void {
  if (transactions.length === 0) {
    console.log(`\n❌ No mint/redeem transactions found in the last ${daysToQuery} day${daysToQuery !== 1 ? 's' : ''}.\n`)
    return
  }

  const daysLabel = transactions.length > 0 
    ? `Last ${Math.round((Date.now() - transactions[transactions.length - 1].time.getTime()) / (24 * 60 * 60 * 1000))} Days`
    : 'Last Period'
  
  console.log('\n' + '='.repeat(180))
  console.log(`MINT/REDEEM EXECUTIONS ON QUEUE (${daysLabel})`)
  console.log('='.repeat(180))
  console.log('')

  // Table header matching the image format
  const headers = [
    'time',
    'hash',
    'Status',
    'Type',
    'Amount Minted/Redeemed',
    'Receiver',
    'Amount Sent/Received',
    'Returned?',
    'Value Returned',
    'Token Returned',
    'Block Number',
  ]
  
  const colWidths = [20, 20, 8, 15, 22, 22, 22, 10, 15, 22, 12]
  
  // Print header
  console.log(
    headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ')
  )
  console.log('-'.repeat(180))

  // Print rows
  for (const tx of transactions) {
    const time = tx.time.toISOString().replace('T', ' ').substring(0, 19)
    const hash = tx.hash.substring(0, 18) + '...'
    const status = tx.status.padEnd(8)
    const type = tx.type.padEnd(15)
    const amount = tx.amountMintedRedeemed.padEnd(22)
    const receiver = (tx.receiver.substring(0, 19) + '...').padEnd(22)
    const amountSent = tx.amountSentReceived.padEnd(22)
    const returned = (tx.returned ? 'true' : 'false').padEnd(10)
    const valueReturned = tx.valueReturned.padEnd(15)
    const tokenReturned = tx.tokenReturned === ZERO_ADDRESS ? '0' : (tx.tokenReturned.substring(0, 19) + '...').padEnd(22)
    const blockNum = tx.blockNumber.toString().padEnd(12)

    console.log(
      [
        time.padEnd(colWidths[0]),
        hash.padEnd(colWidths[1]),
        status.padEnd(colWidths[2]),
        type.padEnd(colWidths[3]),
        amount.padEnd(colWidths[4]),
        receiver.padEnd(colWidths[5]),
        amountSent.padEnd(colWidths[6]),
        returned.padEnd(colWidths[7]),
        valueReturned.padEnd(colWidths[8]),
        tokenReturned.padEnd(colWidths[9]),
        blockNum.padEnd(colWidths[10]),
      ].join(' | ')
    )
  }

  console.log('-'.repeat(180))
  console.log(`\nTotal Transactions: ${transactions.length}`)
  
  const mints = transactions.filter(tx => tx.type.includes('Mint'))
  const redeems = transactions.filter(tx => tx.type.includes('Redeem'))
  const usdrifTxs = transactions.filter(tx => tx.type.includes('USDRIF'))
  const rifproTxs = transactions.filter(tx => tx.type.includes('RifPro'))
  
  console.log(`Mints: ${mints.length} | Redeems: ${redeems.length}`)
  console.log(`USDRIF: ${usdrifTxs.length} | RifPro: ${rifproTxs.length}`)
  console.log('='.repeat(180) + '\n')
}

function exportToCSV(transactions: EnhancedTransaction[], daysToQuery: number): string {
  // CSV headers matching the table columns
  const headers = [
    'time',
    'hash',
    'Status',
    'Type',
    'Amount Minted/Redeemed',
    'Receiver',
    'Amount Sent/Received',
    'Returned?',
    'Value Returned',
    'Token Returned',
    'Block Number',
  ]

  // Build CSV content
  const rows: string[] = []
  
  // Always add headers (even if no transactions)
  rows.push(headers.map(h => `"${h}"`).join(','))
  
  // Add data rows (if any)
  for (const tx of transactions) {
    const time = tx.time.toISOString().replace('T', ' ').substring(0, 19)
    const hash = tx.hash
    const status = tx.status
    const type = tx.type
    const amountMintedRedeemed = tx.amountMintedRedeemed
    const receiver = tx.receiver
    const amountSentReceived = tx.amountSentReceived
    const returned = tx.returned ? 'true' : 'false'
    const valueReturned = tx.valueReturned
    const tokenReturned = tx.tokenReturned === ZERO_ADDRESS ? '0' : tx.tokenReturned
    const blockNumber = tx.blockNumber.toString()

    // Escape quotes and wrap in quotes for Excel compatibility
    const escapeCSV = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    }

    rows.push([
      escapeCSV(time),
      escapeCSV(hash),
      escapeCSV(status),
      escapeCSV(type),
      escapeCSV(amountMintedRedeemed),
      escapeCSV(receiver),
      escapeCSV(amountSentReceived),
      escapeCSV(returned),
      escapeCSV(valueReturned),
      escapeCSV(tokenReturned),
      escapeCSV(blockNumber),
    ].join(','))
  }

  return rows.join('\n')
}

function generateCSVFilename(daysToQuery: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
  const filename = `mint-redeem-executions-${daysToQuery}days-${timestamp}.csv`
  return path.join(process.cwd(), filename)
}

async function trackMintRedeemTransactions() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2)
    let daysToQuery = 7
    let exportCSV = false
    
    // Parse arguments
    for (const arg of args) {
      if (arg === '--csv' || arg === '-c') {
        exportCSV = true
      } else if (!isNaN(parseInt(arg, 10))) {
        daysToQuery = parseInt(arg, 10)
      }
    }
    
    if (daysToQuery <= 0) {
      console.error('❌ Error: Days parameter must be a positive number')
      console.error('Usage: npx tsx track-mint-redeem-enhanced.ts [days] [--csv]')
      console.error('Example: npx tsx track-mint-redeem-enhanced.ts 7 --csv')
      process.exit(1)
    }
    
    console.log('🔍 Tracking USDRIF and RifPro Mint/Redeem Transactions...\n')
    console.log(`USDRIF Contract: ${USDRIF_ADDRESS}`)
    console.log(`RifPro Contract: ${RIFPRO_ADDRESS}`)
    console.log(`Using Blockscout API: ${BLOCKSCOUT_API}`)
    console.log(`Looking back: ${daysToQuery} day${daysToQuery !== 1 ? 's' : ''}`)
    if (exportCSV) {
      console.log(`📄 CSV export: ENABLED`)
    }
    console.log('')

    const provider = new ethers.JsonRpcProvider(ROOTSTOCK_RPC)

    // Get current block number
    await delay(200) // Rate limit protection for RPC
    const currentBlock = await provider.getBlockNumber()
    console.log(`Current Block: ${currentBlock}`)

    // Calculate block range
    const blocksPerDay = 2880
    const blockRange = blocksPerDay * daysToQuery
    const fromBlock = Math.max(0, currentBlock - blockRange)
    
    console.log(`Querying blocks: ${fromBlock} to ${currentBlock} (last ${daysToQuery} day${daysToQuery !== 1 ? 's' : ''})\n`)

    // Transfer event signature
    const transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const zeroAddressChecksummed = ethers.getAddress(ZERO_ADDRESS)
    
    // Query Transfer events for both tokens and RIF collateral
    console.log('📡 Fetching Transfer events from Blockscout...')
    const usdrifAddress = await getChecksummedAddress(USDRIF_ADDRESS)
    const rifproAddress = await getChecksummedAddress(RIFPRO_ADDRESS)
    const rifAddress = await getChecksummedAddress(RIF_TOKEN_ADDRESS)
    const mocCoreAddress = await getChecksummedAddress(MOC_V2_CORE)
    
    const [usdrifLogs, rifproLogs, rifLogs] = await Promise.all([
      fetchLogsFromBlockscout(usdrifAddress, fromBlock, currentBlock, transferEventTopic),
      fetchLogsFromBlockscout(rifproAddress, fromBlock, currentBlock, transferEventTopic),
      fetchLogsFromBlockscout(rifAddress, fromBlock, currentBlock, transferEventTopic),
    ])
    
    console.log(`Found ${usdrifLogs.length} USDRIF Transfer events`)
    console.log(`Found ${rifproLogs.length} RifPro Transfer events`)
    console.log(`Found ${rifLogs.length} RIF Transfer events (for collateral tracking)`)
    
    // Query MoC contract events for mint/redeem operations
    console.log('\n📡 Querying MoC contract events...')
    const mocInterface = new ethers.Interface(MOC_ABI)
    
    // Event signatures
    const mintEventTopic = mocInterface.getEvent('MintStableToken').topicHash
    const mintVendorsEventTopic = mocInterface.getEvent('MintStableTokenVendors').topicHash
    const redeemEventTopic = mocInterface.getEvent('RedeemFreeStableToken').topicHash
    const redeemVendorsEventTopic = mocInterface.getEvent('RedeemFreeStableTokenVendors').topicHash
    
    // Query events from all MoC contract addresses
    const mocEvents: Array<{ log: BlockscoutLog; contractAddress: string }> = []
    for (const mocAddress of MOC_CONTRACT_ADDRESSES) {
      const checksummedMoc = await getChecksummedAddress(mocAddress)
      const [mintEvents, mintVendorsEvents, redeemEvents, redeemVendorsEvents] = await Promise.all([
        fetchMoCEventsFromBlockscout(checksummedMoc, fromBlock, currentBlock, mintEventTopic),
        fetchMoCEventsFromBlockscout(checksummedMoc, fromBlock, currentBlock, mintVendorsEventTopic),
        fetchMoCEventsFromBlockscout(checksummedMoc, fromBlock, currentBlock, redeemEventTopic),
        fetchMoCEventsFromBlockscout(checksummedMoc, fromBlock, currentBlock, redeemVendorsEventTopic),
      ])
      
      mintEvents.forEach(e => mocEvents.push({ log: e, contractAddress: checksummedMoc }))
      mintVendorsEvents.forEach(e => mocEvents.push({ log: e, contractAddress: checksummedMoc }))
      redeemEvents.forEach(e => mocEvents.push({ log: e, contractAddress: checksummedMoc }))
      redeemVendorsEvents.forEach(e => mocEvents.push({ log: e, contractAddress: checksummedMoc }))
    }
    
    console.log(`Found ${mocEvents.length} MoC contract events\n`)
    
    // Group MoC events by transaction hash
    const mocEventsByTx = new Map<string, Array<{ log: BlockscoutLog; contractAddress: string; decoded: any }>>()
    for (const { log, contractAddress } of mocEvents) {
      try {
        const decoded = mocInterface.parseLog({
          topics: log.topics,
          data: log.data,
        })
        
        if (!mocEventsByTx.has(log.transactionHash)) {
          mocEventsByTx.set(log.transactionHash, [])
        }
        mocEventsByTx.get(log.transactionHash)!.push({ log, contractAddress, decoded })
      } catch (error) {
        // Skip events that can't be decoded
        continue
      }
    }
    
    // Group RIF transfers by transaction hash for quick lookup
    const rifTransfersByTx = new Map<string, Array<{ from: string; to: string; value: bigint }>>()
    for (const log of rifLogs) {
      if (log.topics.length < 3) continue
      
      const fromTopic = log.topics[1]
      const toTopic = log.topics[2]
      const fromAddr = '0x' + fromTopic.slice(-40).toLowerCase()
      const toAddr = '0x' + toTopic.slice(-40).toLowerCase()
      const value = BigInt(log.data || '0x0')
      
      const fromChecksummed = ethers.getAddress(fromAddr)
      const toChecksummed = ethers.getAddress(toAddr)
      
      if (!rifTransfersByTx.has(log.transactionHash)) {
        rifTransfersByTx.set(log.transactionHash, [])
      }
      rifTransfersByTx.get(log.transactionHash)!.push({
        from: fromChecksummed,
        to: toChecksummed,
        value,
      })
    }

    // Process events
    const allEvents: Array<{
      log: BlockscoutLog
      tokenType: 'USDRIF' | 'RifPro'
      from: string
      to: string
      value: bigint
      direction: 'MINT' | 'REDEEM'
    }> = []

    console.log('🔍 Filtering mint/redeem events...')
    
    // Process USDRIF events
    for (const log of usdrifLogs) {
      if (log.topics.length < 3) continue
      
      const fromTopic = log.topics[1]
      const toTopic = log.topics[2]
      const fromAddr = '0x' + fromTopic.slice(-40).toLowerCase()
      const toAddr = '0x' + toTopic.slice(-40).toLowerCase()
      const value = BigInt(log.data || '0x0')

      const fromChecksummed = ethers.getAddress(fromAddr)
      const toChecksummed = ethers.getAddress(toAddr)

      if (fromChecksummed === zeroAddressChecksummed && toChecksummed !== zeroAddressChecksummed) {
        allEvents.push({ log, tokenType: 'USDRIF', from: fromChecksummed, to: toChecksummed, value, direction: 'MINT' })
      } else if (toChecksummed === zeroAddressChecksummed && fromChecksummed !== zeroAddressChecksummed) {
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

      const fromChecksummed = ethers.getAddress(fromAddr)
      const toChecksummed = ethers.getAddress(toAddr)

      if (fromChecksummed === zeroAddressChecksummed && toChecksummed !== zeroAddressChecksummed) {
        allEvents.push({ log, tokenType: 'RifPro', from: fromChecksummed, to: toChecksummed, value, direction: 'MINT' })
      } else if (toChecksummed === zeroAddressChecksummed && fromChecksummed !== zeroAddressChecksummed) {
        allEvents.push({ log, tokenType: 'RifPro', from: fromChecksummed, to: toChecksummed, value, direction: 'REDEEM' })
      }
    }

    console.log(`Found ${allEvents.length} mint/redeem events\n`)

    // Fetch block data and transaction details
    console.log('📦 Fetching block timestamps and transaction details...')
    const uniqueBlockNumbers = [...new Set(allEvents.map(e => parseInt(e.log.blockNumber, 16)))].sort((a, b) => a - b)
    const uniqueTxHashes = [...new Set(allEvents.map(e => e.log.transactionHash))]
    
    const blockCache = new Map<number, ethers.Block>()
    const txCache = new Map<string, BlockscoutTxResponse['result'] | null>()
    const txInputCache = new Map<string, { functionName: string | null; args: any[] | null }>()
    
    // Fetch blocks sequentially with delays to avoid RPC rate limiting
    for (let i = 0; i < uniqueBlockNumbers.length; i++) {
      const blockNum = uniqueBlockNumbers[i]
      // Add delay before each request (except the first)
      if (i > 0) await delay(200)
      
      try {
        const block = await provider.getBlock(blockNum)
        if (block) blockCache.set(blockNum, block)
      } catch (error) {
        console.error(`\nFailed to fetch block ${blockNum}:`, error)
        // Continue with next block
      }
      
      if ((i + 1) % 10 === 0 || i === uniqueBlockNumbers.length - 1) {
        process.stdout.write(`\r  Blocks: ${i + 1}/${uniqueBlockNumbers.length}`)
      }
    }
    
    // Fetch transaction details and decode input data
    console.log(`\n  Fetching transaction details for ${uniqueTxHashes.length} transactions...`)
    // Reuse mocInterface from earlier
    const mocInterfaceForTx = new ethers.Interface(MOC_ABI)
    
    for (let i = 0; i < Math.min(uniqueTxHashes.length, 50); i++) { // Limit to 50 to avoid rate limits
      const txHash = uniqueTxHashes[i]
      const txData = await fetchTransactionFromBlockscout(txHash)
      txCache.set(txHash, txData)
      
      // Decode transaction input
      if (txData?.input) {
        const decoded = decodeTransactionInput(txData.input, mocInterfaceForTx)
        txInputCache.set(txHash, decoded)
      }
      
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r  Transactions: ${i + 1}/${Math.min(uniqueTxHashes.length, 50)}`)
      }
    }
    console.log('\n')

    // Build enhanced transaction list with collateral amounts
    const enhancedTxs: EnhancedTransaction[] = []
    for (const { log, tokenType, from, to, value, direction } of allEvents) {
      const blockNumber = parseInt(log.blockNumber, 16)
      const block = blockCache.get(blockNumber)
      if (!block) continue

      const txData = txCache.get(log.transactionHash)
      const status: 'Success' | 'Failed' = txData?.isError === '1' ? 'Failed' : 'Success'
      
      const type = `${tokenType} ${direction === 'MINT' ? 'Mint' : 'Redeem'}` as EnhancedTransaction['type']
      const receiver = direction === 'MINT' ? to : from
      
      // Try to get collateral amount from multiple sources (priority order):
      // 1. MoC contract events (most reliable)
      // 2. Transaction input data (function parameters)
      // 3. RIF Transfer events (fallback)
      
      let collateralAmount = 0n
      let tokenReturnedAddr = ZERO_ADDRESS
      
      // Method 1: Check MoC contract events
      const mocTxEvents = mocEventsByTx.get(log.transactionHash) || []
      for (const { decoded } of mocTxEvents) {
        if (decoded.name === 'MintStableToken' || decoded.name === 'MintStableTokenVendors') {
          // reserveTokenAmount is the RIF collateral amount
          const reserveTokenAmount = decoded.args[1] as bigint
          if (reserveTokenAmount > collateralAmount) {
            collateralAmount = reserveTokenAmount
          }
        } else if (decoded.name === 'RedeemFreeStableToken' || decoded.name === 'RedeemFreeStableTokenVendors') {
          // reserveTokenAmount is the RIF returned
          const reserveTokenAmount = decoded.args[2] as bigint
          if (reserveTokenAmount > collateralAmount) {
            collateralAmount = reserveTokenAmount
            tokenReturnedAddr = RIF_TOKEN_ADDRESS
          }
        }
      }
      
      // Method 2: Parse transaction input data if no event found
      if (collateralAmount === 0n) {
        const txInput = txInputCache.get(log.transactionHash)
        if (txInput?.functionName) {
          if (txInput.functionName === 'mintStableToken' || txInput.functionName === 'mintStableTokenVendors') {
            // First parameter is reserveTokenAmount (RIF collateral)
            if (txInput.args && txInput.args.length > 0) {
              try {
                collateralAmount = BigInt(txInput.args[0].toString())
              } catch (e) {
                // If args[0] is already a bigint, use it directly
                if (typeof txInput.args[0] === 'bigint') {
                  collateralAmount = txInput.args[0]
                }
              }
            }
          } else if (txInput.functionName === 'redeemFreeStableToken' || txInput.functionName === 'redeemFreeStableTokenVendors') {
            // For redeems, the amount returned is calculated by the contract
            // We can't get it directly from input, but we can try RIF transfers
            tokenReturnedAddr = RIF_TOKEN_ADDRESS
          }
        }
        
        // Debug: Log first few transactions to see what we're parsing
        if (enhancedTxs.length < 3 && txInput) {
          console.log(`\n[DEBUG TX Input] ${log.transactionHash.substring(0, 20)}...`)
          console.log(`  Function: ${txInput.functionName || 'unknown'}`)
          if (txInput.args) {
            console.log(`  Args: ${txInput.args.length} parameters`)
            txInput.args.slice(0, 2).forEach((arg, idx) => {
              const val = typeof arg === 'bigint' ? formatAmount(arg, 18) : arg.toString()
              console.log(`    ${idx}: ${val}`)
            })
          }
        }
      }
      
      // Method 3: Fallback to RIF Transfer events
      if (collateralAmount === 0n) {
        const rifTransfers = rifTransfersByTx.get(log.transactionHash) || []
        
        if (direction === 'MINT') {
          // For mints: Sum all RIF transfers TO MoC contract (collateral being locked)
          for (const rifTx of rifTransfers) {
            if (rifTx.to.toLowerCase() === mocCoreAddress.toLowerCase()) {
              collateralAmount += rifTx.value
            }
          }
        } else {
          // For redeems: MoC returns RIF collateral TO the user
          for (const rifTx of rifTransfers) {
            if (rifTx.from.toLowerCase() === mocCoreAddress.toLowerCase() && 
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

      enhancedTxs.push({
        time: new Date(block.timestamp * 1000),
        hash: log.transactionHash,
        status,
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

    // Sort by timestamp (newest first)
    enhancedTxs.sort((a, b) => b.time.getTime() - a.time.getTime())

    // Filter to requested time period
    const cutoffTime = Date.now() - (daysToQuery * 24 * 60 * 60 * 1000)
    const recentTxs = enhancedTxs.filter(tx => tx.time.getTime() >= cutoffTime)

    // Display results
    formatTable(recentTxs, daysToQuery)
    
    // Export to CSV if requested
    if (exportCSV) {
      if (recentTxs.length > 0) {
        const csvContent = exportToCSV(recentTxs, daysToQuery)
        const csvFilename = generateCSVFilename(daysToQuery)
        
        try {
          fs.writeFileSync(csvFilename, csvContent, 'utf-8')
          console.log(`\n✅ CSV exported successfully: ${csvFilename}`)
          console.log(`   ${recentTxs.length} transaction${recentTxs.length !== 1 ? 's' : ''} exported\n`)
        } catch (error) {
          console.error(`\n❌ Error writing CSV file: ${error}`)
          if (error instanceof Error) {
            console.error(`   Error: ${error.message}`)
            console.error(`   Stack: ${error.stack}\n`)
          } else {
            console.error(`   Unknown error: ${String(error)}\n`)
          }
          process.exit(1)
        }
      } else {
        // Still create CSV file with headers even if no transactions
        const csvContent = exportToCSV([], daysToQuery)
        const csvFilename = generateCSVFilename(daysToQuery)
        
        try {
          fs.writeFileSync(csvFilename, csvContent, 'utf-8')
          console.log(`\n⚠️  No transactions found, but CSV file created with headers: ${csvFilename}\n`)
        } catch (error) {
          console.error(`\n❌ Error writing CSV file: ${error}`)
          if (error instanceof Error) {
            console.error(`   Error: ${error.message}\n`)
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ Error tracking mint/redeem transactions:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    process.exit(1)
  }
}

trackMintRedeemTransactions()
