import { CONFIG } from '../config'

export const BLOCKSCOUT_API_V2 = 'https://rootstock.blockscout.com/api/v2'

/** Blockscout REST API root for `module=transaction&action=gettxinfo`. */
export const BLOCKSCOUT_EXPLORER_API = 'https://rootstock.blockscout.com/api'

export const VAULT_ADDRESS = CONFIG.VUSD_ADDRESS.toLowerCase()

export const VAULT_ABI = [
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
] as const

export const BLOCKS_PER_DAY = 2880

export const BLOCK_BATCH_SIZE = 5
export const BLOCK_BATCH_DELAY_MS = 100

export const TX_BATCH_SIZE = 5
export const TX_BATCH_DELAY_MS = 150

/**
 * Max tx hashes enriched via gettxinfo (parity with pre-extraction analyser).
 * Rows beyond this limit default to Success unless later extended.
 */
export const VAULT_TX_STATUS_LOOKUP_MAX = 100
