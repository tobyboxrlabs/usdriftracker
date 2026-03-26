import { CONFIG } from '../config'

export const BLOCKSCOUT_API_V1 = 'https://rootstock.blockscout.com/api'
export const USDRIF_ADDRESS = CONFIG.USDRIF_ADDRESS
export const RIFPRO_ADDRESS = CONFIG.RIFPRO_ADDRESS
/** RIF token (collateral) on Rootstock mainnet */
export const RIF_TOKEN_ADDRESS = '0x2acc95758f8b5f583470ba265eb685a8f45fc9d5'
export const MOC_V2_CORE = CONFIG.MOC_V2_CORE

export const MOC_CONTRACT_ADDRESSES = [
  '0xf773B590aF754D597770937Fa8ea7AbDf2668370',
  CONFIG.MOC_V2_CORE,
  '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257',
] as const

export const MOC_CONTRACT_NAMES: Record<string, string> = {
  [MOC_CONTRACT_ADDRESSES[0].toLowerCase()]: 'MoC',
  [CONFIG.MOC_V2_CORE.toLowerCase()]: 'MoC V2 Core',
  [MOC_CONTRACT_ADDRESSES[2].toLowerCase()]: 'MoC State',
}

export const ROC_CONTRACTS_LABEL = MOC_CONTRACT_ADDRESSES.map(
  (a) => MOC_CONTRACT_NAMES[a.toLowerCase()] ?? 'MoC'
).join(', ')

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** ERC-20 Transfer topic */
export const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export const BLOCKS_PER_DAY = 2880

// MoC ABI: mint/redeem functions + events (MintRedeemAnalyser)
export const MOC_ABI = [
  'function mintStableToken(uint256 reserveTokenAmount, address vendorAccount)',
  'function mintStableTokenVendors(uint256 reserveTokenAmount, address vendorAccount)',
  'function redeemFreeStableToken(uint256 stableTokenAmount, address vendorAccount)',
  'function redeemFreeStableTokenVendors(uint256 stableTokenAmount, address vendorAccount)',
  'event MintStableToken(address indexed account, uint256 reserveTokenAmount, uint256 stableTokenAmount, address indexed vendorAccount)',
  'event RedeemFreeStableToken(address indexed account, uint256 stableTokenAmount, uint256 reserveTokenAmount, address indexed vendorAccount)',
  'event MintStableTokenVendors(address indexed account, uint256 reserveTokenAmount, uint256 stableTokenAmount, address indexed vendorAccount)',
  'event RedeemFreeStableTokenVendors(address indexed account, uint256 stableTokenAmount, uint256 reserveTokenAmount, address indexed vendorAccount)',
] as const
