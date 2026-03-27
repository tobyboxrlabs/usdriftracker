/**
 * Pure async pipeline: RPC + Blockscout v2 → vUSD vault Deposit/Withdraw rows for Analytics.
 */
import { ethers } from 'ethers'
import { fetchLogsV2 } from '../api/blockscout'
import { formatAmount } from '../utils/amount'
import { isTransientHttpStatus, withBackoff } from '../utils/asyncRetry'
import { logger } from '../utils/logger'
import { rpcCall } from '../utils/rpc'
import {
  BLOCK_BATCH_DELAY_MS,
  BLOCK_BATCH_SIZE,
  BLOCKS_PER_DAY,
  BLOCKSCOUT_API_V2,
  BLOCKSCOUT_EXPLORER_API,
  TX_BATCH_DELAY_MS,
  TX_BATCH_SIZE,
  VAULT_ABI,
  VAULT_ADDRESS,
  VAULT_TX_STATUS_LOOKUP_MAX,
} from './constants'
import type { VaultTransaction } from './types'

export type VaultDepositWithdrawProgress = { current: number; total: number; phase: string }

/** Blockscout gettxinfo: retry transient HTTP; null → treat as Success (optimistic). */
async function fetchVaultTxSuccessFromExplorer(txHash: string): Promise<boolean | null> {
  try {
    return await withBackoff(
      async () => {
        const url = `${BLOCKSCOUT_EXPLORER_API}?module=transaction&action=gettxinfo&txhash=${txHash}`
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

export async function fetchVaultDepositWithdrawTransactions(
  days: number,
  onProgress?: (p: VaultDepositWithdrawProgress | null) => void
): Promise<{
  recentTxs: VaultTransaction[]
  fromBlock: number
  currentBlock: number
}> {
  const emitProgress = (p: VaultDepositWithdrawProgress | null) => {
    onProgress?.(p)
  }

  const blockNumberHex = await rpcCall<string>('eth_blockNumber', [])
  const currentBlock = parseInt(blockNumberHex, 16)

  const blockRange = BLOCKS_PER_DAY * days
  const fromBlock = Math.max(0, currentBlock - blockRange)

  const vaultInterface = new ethers.Interface(VAULT_ABI)
  const depositEvent = vaultInterface.getEvent('Deposit')
  const withdrawEvent = vaultInterface.getEvent('Withdraw')

  if (!depositEvent || !withdrawEvent) {
    throw new Error('Failed to get vault event definitions')
  }

  const depositTopic = depositEvent.topicHash
  const withdrawTopic = withdrawEvent.topicHash

  logger.vault.debug('Event topic hashes:', { deposit: depositTopic, withdraw: withdrawTopic })

  emitProgress({ current: 0, total: 100, phase: 'Fetching vault events...' })

  const allLogs = await fetchLogsV2(BLOCKSCOUT_API_V2, VAULT_ADDRESS, fromBlock, currentBlock)

  logger.vault.debug(`Found ${allLogs.length} total logs`)

  const vaultEvents = allLogs.filter((log) => {
    if (!log.topics || log.topics.length === 0) return false
    const eventTopic = log.topics[0]
    return eventTopic === depositTopic || eventTopic === withdrawTopic
  })

  logger.vault.debug(`Found ${vaultEvents.length} vault events (Deposit/Withdraw)`)

  emitProgress({ current: 30, total: 100, phase: 'Fetching block timestamps...' })

  const uniqueBlockNumbers = [...new Set(vaultEvents.map((e) => e.block_number))].sort((a, b) => a - b)
  const blockTimestamps = new Map<number, Date>()

  const totalBlocks = uniqueBlockNumbers.length

  for (let i = 0; i < uniqueBlockNumbers.length; i += BLOCK_BATCH_SIZE) {
    const batch = uniqueBlockNumbers.slice(i, i + BLOCK_BATCH_SIZE)

    if (totalBlocks > 0) {
      const blockProgress = 30 + Math.floor((i / totalBlocks) * 40)
      emitProgress({
        current: Math.min(blockProgress, 70),
        total: 100,
        phase: `Fetching block timestamps... (${Math.min(i + BLOCK_BATCH_SIZE, totalBlocks)}/${totalBlocks} blocks)`,
      })
    }

    const blockPromises = batch.map(async (blockNum) => {
      try {
        const blockHex = `0x${blockNum.toString(16)}`
        const blockData = await rpcCall<{ timestamp?: string }>('eth_getBlockByNumber', [blockHex, false])

        if (blockData?.timestamp) {
          return { blockNum, timestamp: parseInt(blockData.timestamp, 16) }
        }
        return null
      } catch {
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
      await new Promise((resolve) => setTimeout(resolve, BLOCK_BATCH_DELAY_MS))
    }
  }

  emitProgress({ current: 70, total: 100, phase: 'Fetching transaction details...' })

  const uniqueTxHashes = [...new Set(vaultEvents.map((e) => e.transaction_hash))]
  const txStatusByHash = new Map<string, 'Success' | 'Failed'>()

  const txDetailsLimit = Math.min(uniqueTxHashes.length, VAULT_TX_STATUS_LOOKUP_MAX)

  for (let i = 0; i < txDetailsLimit; i += TX_BATCH_SIZE) {
    const batch = uniqueTxHashes.slice(i, i + TX_BATCH_SIZE)

    if (txDetailsLimit > 0) {
      const txProgress = 70 + Math.floor((i / txDetailsLimit) * 20)
      emitProgress({
        current: Math.min(txProgress, 90),
        total: 100,
        phase: `Fetching transaction details... (${Math.min(i + TX_BATCH_SIZE, txDetailsLimit)}/${txDetailsLimit})`,
      })
    }

    const txPromises = batch.map(async (txHash) => {
      const successFlag = await fetchVaultTxSuccessFromExplorer(txHash)
      const status: 'Success' | 'Failed' = successFlag === false ? 'Failed' : 'Success'
      return { txHash, status }
    })

    const results = await Promise.all(txPromises)
    for (const result of results) {
      txStatusByHash.set(result.txHash, result.status)
    }

    if (i + TX_BATCH_SIZE < txDetailsLimit) {
      await new Promise((resolve) => setTimeout(resolve, TX_BATCH_DELAY_MS))
    }
  }

  emitProgress({ current: 90, total: 100, phase: 'Processing transactions...' })

  const txs: VaultTransaction[] = []

  for (const log of vaultEvents) {
    const blockNumber = log.block_number
    const timestamp = blockTimestamps.get(blockNumber)
    if (!timestamp) continue

    const decoded = log.decoded
    if (!decoded) continue

    const eventTopic = log.topics?.[0]
    const isDeposit = eventTopic === depositTopic
    const isWithdraw = eventTopic === withdrawTopic

    if (!isDeposit && !isWithdraw) continue

    const params = decoded.parameters || []
    let assets = 0n
    let receiver = ''

    if (isDeposit) {
      const ownerParam = params.find((p) => p.name === 'owner')
      const assetsParam = params.find((p) => p.name === 'assets')

      if (ownerParam && assetsParam) {
        receiver = ownerParam.value.toLowerCase()
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
      const receiverParam = params.find((p) => p.name === 'receiver')
      const assetsParam = params.find((p) => p.name === 'assets')

      if (receiverParam && assetsParam) {
        receiver = receiverParam.value.toLowerCase()
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

    if (!receiver) {
      logger.vault.warn(`Skipping event - missing receiver, tx: ${log.transaction_hash}`)
      continue
    }

    if (assets === 0n) {
      logger.vault.warn(
        `Skipping event - zero assets, tx: ${log.transaction_hash}`,
        params.map((p) => `${p.name}=${p.value}`).join(', ')
      )
      continue
    }

    const status = txStatusByHash.get(log.transaction_hash) || 'Success'

    const formattedAmount = formatAmount(assets, 18)

    if (txs.length < 3) {
      logger.vault.debug(`${isDeposit ? 'Deposit' : 'Withdraw'}:`, {
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

  txs.sort((a, b) => b.time.getTime() - a.time.getTime())
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000
  const recentTxs = txs.filter((tx) => tx.time.getTime() >= cutoffTime)

  emitProgress({ current: 100, total: 100, phase: 'Complete' })
  logger.vault.info(`Fetched ${recentTxs.length} vault txs (${days}d) | blocks ${fromBlock}–${currentBlock}`)

  return { recentTxs, fromBlock, currentBlock }
}
