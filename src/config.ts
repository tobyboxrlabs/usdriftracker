// Configuration for USDRIF tracker
export const CONFIG = {
  // Rootstock RPC endpoint
  // Try multiple endpoints as fallback for CORS issues
  // Note: Some public nodes may have CORS restrictions. 
  // For production, consider using a CORS-enabled RPC service or configure your own endpoint
  ROOTSTOCK_RPC: import.meta.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co',
  ROOTSTOCK_RPC_ALTERNATIVES: [
    'https://public-node.rsk.co',
    'https://rsk.publicnode.com',
    'https://rpc.ankr.com/rsk',
  ],
  
  // stRIF token address (mainnet) - will be checksummed when used
  USDRIF_ADDRESS: import.meta.env.VITE_USDRIF_ADDRESS || '0x5db91e24BD32059584bbDb831A901f1199f3d459',
  
  // USDRIF token address - used for USDRIF Minted metric - will be checksummed when used
  USDRIF_OLD_ADDRESS: import.meta.env.VITE_USDRIF_OLD_ADDRESS || '0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37',
  
  // RIFPRO token address (for future metrics) - will be checksummed when used
  RIFPRO_ADDRESS: import.meta.env.VITE_RIFPRO_ADDRESS || '0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61',
  
  // Money on Chain State contract addresses (try primary first, then fallback)
  MOC_STATE_ADDRESSES: [
    import.meta.env.VITE_MOC_STATE_ADDRESS || '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257', // Primary MoCState
    '0x541f68a796fe5ae3a381d2aa5a50b975632e40a6', // Legacy mocstateContract (deprecated but may have some functions)
    '0xb8a6beba78c3e73f6a66ddacfaeb240ae22ca709', // MoC Settlement
  ],
  
  // Additional contract addresses for future metrics
  USDRIF_FEE_COLLECTOR: '0x4905f643db489d9561617638d31875b6bff79077',
  PROTOCOL_REVENUE_DISTRIBUTOR: '0xf7fdf7F777C43Cd31c4c37Ee851F08A51abD2dB5',
  RIF_PRICE_FEED_MOC: '0x461750b4824b14c3d9b7702bc6fbb82469082b23',
  RIF_PRICE_FEED_RLABS: '0xbed51d83cc4676660e3fc3819dfad8238549b975',
  MOC_SETTLEMENT: '0xb8a6beba78c3e73f6a66ddacfaeb240ae22ca709',
  MOC_SETTLEMENT_ALT: '0xe3abce2b0ee0d7ea48a5bcd0442d5505ae5b6334',
  
  // MoC V2 Core contract (for RIF collateral)
  MOC_V2_CORE: '0xA27024Ed70035E46dba712609fc2Afa1c97aA36A',
  
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

// Money on Chain State contract ABI - only the functions we need
export const MOC_STATE_ABI = [
  'function absoluteMaxDoc() view returns (uint256)',
  'function docTotalSupply() view returns (uint256)',
  'function minted() view returns (uint256)',
  'function minted(address) view returns (uint256)',
  'function getMinted() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function availableToMint() view returns (uint256)',
  'function availableToMint(address) view returns (uint256)',
  'function maxMintable() view returns (uint256)',
  'function getMaxMintable() view returns (uint256)',
] as const

// Price Feed ABI (for RIF price oracle)
export const PRICE_FEED_ABI = [
  'function read() view returns (uint256)',
  'function peek() view returns (bytes32, bool)',
] as const

// MoC Core V2 ABI (for RIF collateral)
export const MOC_CORE_ABI = [
  'function getTotalACavailable() view returns (uint256)',
  'function getLckAC() view returns (uint256)',
  'function acToken() view returns (address)',
] as const
