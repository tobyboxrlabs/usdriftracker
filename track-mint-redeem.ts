#!/usr/bin/env node
/**
 * Track USDRIF Mint/Redeem Transactions
 * 
 * This script queries Transfer events from the USDRIF contract to identify
 * mint and redeem transactions over the last 7 days.
 * 
 * Mint transactions: Transfer from zero address (0x0000...) to recipient
 * Redeem transactions: Transfer from user to zero address (burn)
 * 
 * Usage:
 *   npx tsx track-mint-redeem.ts
 * 
 * Environment variables (optional):
 *   VITE_ROOTSTOCK_RPC - Rootstock RPC endpoint (default: https://public-node.rsk.co)
 *   VITE_USDRIF_ADDRESS - USDRIF contract address (default: 0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37)
 */

import { ethers } from 'ethers'

// Configuration
const ROOTSTOCK_RPC = process.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co'
const BLOCKSCOUT_API = 'https://rootstock.blockscout.com/api'
const USDRIF_ADDRESS = process.env.VITE_USDRIF_ADDRESS || '0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37'

// ERC20 Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
] as const

// Zero address used for minting (from) and redeeming (to)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

interface MintRedeemTransaction {
  txHash: string
  blockNumber: number
  timestamp: Date
  direction: 'MINT' | 'REDEEM'
  amount: string
  amountFormatted: string
  from: string
  to: string
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

function formatTable(transactions: MintRedeemTransaction[]): void {
  if (transactions.length === 0) {
    console.log('\n❌ No mint/redeem transactions found in the last 7 days.\n')
    return
  }

  console.log('\n' + '='.repeat(120))
  console.log('USDRIF MINT/REDEEM TRANSACTIONS (Last 7 Days)')
  console.log('='.repeat(120))
  console.log('')

  // Table header
  const header = [
    'Date/Time (UTC)',
    'Direction',
    'Amount (USDRIF)',
    'Transaction Hash',
  ]
  
  const colWidths = [22, 10, 20, 66]
  
  // Print header
  console.log(
    header.map((h, i) => h.padEnd(colWidths[i])).join(' | ')
  )
  console.log('-'.repeat(120))

  // Print rows
  for (const tx of transactions) {
    const datetime = tx.timestamp.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
    const direction = tx.direction === 'MINT' ? '🟢 MINT' : '🔴 REDEEM'
    const amount = tx.amountFormatted.padEnd(18)
    const txHash = tx.txHash.substring(0, 66)

    console.log(
      [
        datetime.padEnd(colWidths[0]),
        direction.padEnd(colWidths[1]),
        amount.padEnd(colWidths[2]),
        txHash.padEnd(colWidths[3]),
      ].join(' | ')
    )
  }

  console.log('-'.repeat(120))
  console.log(`\nTotal Transactions: ${transactions.length}`)
  console.log(`Mints: ${transactions.filter(tx => tx.direction === 'MINT').length}`)
  console.log(`Redeems: ${transactions.filter(tx => tx.direction === 'REDEEM').length}`)
  
  // Calculate totals
  const totalMinted = transactions
    .filter(tx => tx.direction === 'MINT')
    .reduce((sum, tx) => sum + parseFloat(tx.amountFormatted), 0)
  const totalRedeemed = transactions
    .filter(tx => tx.direction === 'REDEEM')
    .reduce((sum, tx) => sum + parseFloat(tx.amountFormatted), 0)
  
  console.log(`\nTotal Minted: ${totalMinted.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDRIF`)
  console.log(`Total Redeemed: ${totalRedeemed.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDRIF`)
  console.log(`Net Change: ${(totalMinted - totalRedeemed).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDRIF`)
  console.log('='.repeat(120) + '\n')
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

async function fetchLogsFromBlockscout(
  address: string,
  fromBlock: number,
  toBlock: number,
  topic0: string
): Promise<BlockscoutLog[]> {
  const url = `${BLOCKSCOUT_API}?module=logs&action=getLogs&address=${address}&fromBlock=${fromBlock}&toBlock=${toBlock}&topic0=${topic0}&page=1&offset=10000`
  
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Blockscout API error: ${response.status} ${response.statusText}`)
  }
  
  const data = (await response.json()) as BlockscoutResponse
  if (data.status !== '1') {
    throw new Error(`Blockscout API error: ${data.message}`)
  }
  
  return data.result || []
}

async function getChecksummedAddress(address: string): Promise<string> {
  try {
    return ethers.getAddress(address)
  } catch {
    return ethers.getAddress(address.toLowerCase())
  }
}

async function trackMintRedeemTransactions() {
  try {
    console.log('🔍 Tracking USDRIF Mint/Redeem Transactions...\n')
    console.log(`USDRIF Contract: ${USDRIF_ADDRESS}`)
    console.log(`Using Blockscout API: ${BLOCKSCOUT_API}\n`)

    const provider = new ethers.JsonRpcProvider(ROOTSTOCK_RPC)

    // Get current block number
    const currentBlock = await provider.getBlockNumber()
    console.log(`Current Block: ${currentBlock}`)

    // Calculate block range for last 7 days
    // Rootstock blocks are ~30 seconds, so ~2,880 blocks per day
    // For 7 days: ~20,160 blocks
    // Use a larger range to be safe (30,000 blocks ≈ 10+ days)
    const blocksPerDay = 2880
    const daysToQuery = 7
    const blockRange = blocksPerDay * daysToQuery
    const fromBlock = Math.max(0, currentBlock - blockRange)
    
    console.log(`Querying blocks: ${fromBlock} to ${currentBlock} (last ${daysToQuery} days)\n`)

    // Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
    // Keccak256 hash of "Transfer(address,address,uint256)"
    const transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    
    // Query Transfer events from Blockscout
    console.log('📡 Fetching Transfer events from Blockscout...')
    const checksummedAddress = await getChecksummedAddress(USDRIF_ADDRESS)
    const logs = await fetchLogsFromBlockscout(checksummedAddress, fromBlock, currentBlock, transferEventTopic)
    
    console.log(`Found ${logs.length} Transfer events total\n`)

    // Filter for mint/redeem transactions
    const mintRedeemEvents: Array<{
      log: BlockscoutLog
      from: string
      to: string
      value: bigint
      direction: 'MINT' | 'REDEEM'
    }> = []
    const zeroAddressChecksummed = ethers.getAddress(ZERO_ADDRESS)

    console.log('🔍 Filtering mint/redeem events...')
    
    for (const log of logs) {
      if (log.topics.length < 3) continue // Need at least 3 topics (event sig, from, to)
      
      try {
        // Extract addresses directly from topics (they're indexed, so in topics)
        const fromTopic = log.topics[1]
        const toTopic = log.topics[2]
        const fromAddr = '0x' + fromTopic.slice(-40).toLowerCase() // Last 20 bytes
        const toAddr = '0x' + toTopic.slice(-40).toLowerCase()
        
        // Extract value from data field (it's not indexed, so in data)
        // Data is a hex string representing the uint256 value
        const value = BigInt(log.data || '0x0')

        const fromChecksummed = ethers.getAddress(fromAddr)
        const toChecksummed = ethers.getAddress(toAddr)

        // Mint: Transfer from zero address (0x0000...)
        if (fromChecksummed === zeroAddressChecksummed && toChecksummed !== zeroAddressChecksummed) {
          mintRedeemEvents.push({
            log,
            from: fromChecksummed,
            to: toChecksummed,
            value,
            direction: 'MINT',
          })
        }
        // Redeem: Transfer to zero address (burn)
        else if (toChecksummed === zeroAddressChecksummed && fromChecksummed !== zeroAddressChecksummed) {
          mintRedeemEvents.push({
            log,
            from: fromChecksummed,
            to: toChecksummed,
            value,
            direction: 'REDEEM',
          })
        }
      } catch (error) {
        // Skip logs that can't be decoded
        continue
      }
    }

    console.log(`Found ${mintRedeemEvents.length} mint/redeem events\n`)

    // Batch fetch block data
    console.log('📦 Fetching block timestamps...')
    const uniqueBlockNumbers = [...new Set(mintRedeemEvents.map(e => parseInt(e.log.blockNumber, 16)))].sort((a, b) => a - b)
    const blockCache = new Map<number, ethers.Block>()
    
    // Fetch blocks in batches of 10
    const batchSize = 10
    for (let i = 0; i < uniqueBlockNumbers.length; i += batchSize) {
      const batch = uniqueBlockNumbers.slice(i, i + batchSize)
      const blocks = await Promise.all(
        batch.map(blockNum => provider.getBlock(blockNum))
      )
      for (let j = 0; j < batch.length; j++) {
        if (blocks[j]) {
          blockCache.set(batch[j], blocks[j]!)
        }
      }
      process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, uniqueBlockNumbers.length)}/${uniqueBlockNumbers.length} blocks`)
    }
    console.log('\n')

    // Build transaction list
    const mintRedeemTxs: MintRedeemTransaction[] = []
    for (const { log, from, to, value, direction } of mintRedeemEvents) {
      const blockNumber = parseInt(log.blockNumber, 16)
      const block = blockCache.get(blockNumber)
      if (!block) continue

      mintRedeemTxs.push({
        txHash: log.transactionHash,
        blockNumber,
        timestamp: new Date(block.timestamp * 1000),
        direction,
        amount: value.toString(),
        amountFormatted: formatAmount(value, 18),
        from,
        to,
      })
    }

    // Sort by timestamp (newest first)
    mintRedeemTxs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Filter to last 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
    const recentTxs = mintRedeemTxs.filter(tx => tx.timestamp.getTime() >= sevenDaysAgo)

    // Display results
    formatTable(recentTxs)

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
