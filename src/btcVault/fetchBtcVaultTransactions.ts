import { fetchLogsV2 } from '../api/blockscout'
import { rpcCall } from '../utils/rpc'
import { BLOCKS_PER_DAY } from './constants'
import { decodeBtcVaultEvent } from './decode'
import { BTC_VAULT_CHAIN } from './network'
import type { BTCVaultChain, BTCVaultTransaction } from './types'
import { fetchRbtcUsdPrice } from './price'

export async function fetchBtcVaultTransactions(params: {
  chain: BTCVaultChain
  days: number
}): Promise<{ recentTxs: BTCVaultTransaction[]; rbtcUsd: number | null }> {
  const net = BTC_VAULT_CHAIN[params.chain]
  const blockNumberHex = await rpcCall<string>('eth_blockNumber', [], net.rpcUrl)
  const currentBlock = parseInt(blockNumberHex ?? '0x0', 16)
  const blockRange = BLOCKS_PER_DAY * params.days
  const fromBlock = Math.max(0, currentBlock - blockRange)

  const logs = await fetchLogsV2(net.blockscoutV2Api, net.vaultAddressLower, fromBlock, currentBlock)
  const decoded = logs.map(decodeBtcVaultEvent).filter((t): t is BTCVaultTransaction => t !== null)
  decoded.sort((a, b) => b.time.getTime() - a.time.getTime())
  const rbtcUsd = await fetchRbtcUsdPrice()
  return { recentTxs: decoded, rbtcUsd }
}
