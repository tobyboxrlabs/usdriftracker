// Configuration for USDRIF tracker
export const CONFIG = {
  // Rootstock RPC endpoint
  ROOTSTOCK_RPC: import.meta.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co',
  
  // USDRIF token address (mainnet) - will be checksummed when used
  USDRIF_ADDRESS: import.meta.env.VITE_USDRIF_ADDRESS || '0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37',
  
  // RIFPRO token address (for future metrics) - will be checksummed when used
  RIFPRO_ADDRESS: import.meta.env.VITE_RIFPRO_ADDRESS || '0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61',
  
  // Money on Chain State contract addresses (try primary first, then fallback)
  MOC_STATE_ADDRESSES: [
    import.meta.env.VITE_MOC_STATE_ADDRESS || '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257', // Primary MoCState
    '0x541f68a796fe5ae3a381d2aa5a50b975632e40a6', // Legacy mocstateContract (deprecated but may have some functions)
  ],
  
  // Additional contract addresses for future metrics
  USDRIF_FEE_COLLECTOR: '0x4905f643db489d9561617638d31875b6bff79077',
  PROTOCOL_REVENUE_DISTRIBUTOR: '0xf7fdf7F777C43Cd31c4c37Ee851F08A51abD2dB5',
  RIF_PRICE_FEED_MOC: '0x461750b4824b14c3d9b7702bc6fbb82469082b23',
  RIF_PRICE_FEED_RLABS: '0xbed51d83cc4676660e3fc3819dfad8238549b975',
  MOC_SETTLEMENT: '0xb8a6beba78c3e73f6a66ddacfaeb240ae22ca709',
  MOC_SETTLEMENT_ALT: '0xe3abce2b0ee0d7ea48a5bcd0442d5505ae5b6334',
  
  // Refresh interval in milliseconds (60 seconds)
  REFRESH_INTERVAL: 60000,
}

// ERC-20 ABI (minimal)
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const

// Money on Chain State contract ABI - V2 compatible
// Try multiple function names in case V2 uses different naming
export const MOC_STATE_ABI = [
  'function absoluteMaxDoc() view returns (uint256)',
  'function absoluteMaxStableToken() view returns (uint256)',
  'function getAbsoluteMaxDoc() view returns (uint256)',
  'function maxDoc() view returns (uint256)',
  'function maxStableToken() view returns (uint256)',
  'function getGlobalCoverage() view returns (uint256)',
] as const
