// Standard token decimals (most ERC20 tokens use 18 decimals)
export const STANDARD_DECIMALS = 18

/**
 * Rootstock **mainnet** BTC Vault deployment (implementations + proxies).
 * Source: team (Francisco Tobar). For the analytics / Blockscout log pipeline, use
 * {@link BTC_VAULT_MAINNET_CONTRACTS.RootstockBTCVaultProxy} — same role as
 * `CONFIG.BTC_VAULT_RBTC_ASYNC_VAULT_PROXY` on testnet.
 */
export const BTC_VAULT_MAINNET_CONTRACTS = {
  BufferRootstockBTCVaultImpl: '0x5E1f8a433b63D1bF1e400F4a60Cc86c6C700506b',
  BufferRootstockBTCVaultProxy: '0x3CFCd9700AF4B0fC10bF9ab5CB28459c409659F7',
  PermissionsManagerRootstockBTCVaultImpl: '0x29fCc62aef216b370a9826f01a9Ab02df8dc94f4',
  PermissionsManagerRootstockBTCVaultProxy: '0x5ff6f00B441844245FAb33E5Fcc18FB1Be76c710',
  RootstockBTCVaultImpl: '0x71dc47Ec8Ce134ce257eb5b5761739f37FBaA038',
  RootstockBTCVaultProxy: '0x5B86e6cE7B7db077e710B27F0Ea869707734ad97',
  SyntheticYieldRootstockBTCVaultImpl: '0xA2c1dB3185F5704efc1eFF577Ea135555302752c',
  SyntheticYieldRootstockBTCVaultProxy: '0xd50A3C7FbB8511E6dC60F497C5abAd7E043d103b',
} as const

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
  ],
  
  // stRIF token address (mainnet) - will be checksummed when used
  STRIF_ADDRESS: import.meta.env.VITE_STRIF_ADDRESS || '0x5db91e24BD32059584bbDb831A901f1199f3d459',
  
  // USDRIF token address - used for USDRIF Minted metric - will be checksummed when used
  USDRIF_ADDRESS: import.meta.env.VITE_USDRIF_ADDRESS || '0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37',
  
  // VUSD token address - used for Vaulted USDRIF metric - will be checksummed when used
  VUSD_ADDRESS: import.meta.env.VITE_VUSD_ADDRESS || '0xd8169270417050dCEf119597a7F6F5EE98dd2fd3',
  
  // RIFPRO token address (for future metrics) - will be checksummed when used
  RIFPRO_ADDRESS: import.meta.env.VITE_RIFPRO_ADDRESS || '0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61',
  
  // Additional contract addresses for future metrics
  USDRIF_FEE_COLLECTOR: '0x4905f643db489d9561617638d31875b6bff79077',
  PROTOCOL_REVENUE_DISTRIBUTOR: '0xf7fdf7F777C43Cd31c4c37Ee851F08A51abD2dB5',
  RIF_PRICE_FEED_MOC: '0x461750b4824b14c3d9b7702bc6fbb82469082b23',
  RIF_PRICE_FEED_RLABS: '0xbed51d83cc4676660e3fc3819dfad8238549b975',
  MOC_SETTLEMENT: '0xb8a6beba78c3e73f6a66ddacfaeb240ae22ca709',
  MOC_SETTLEMENT_ALT: '0xe3abce2b0ee0d7ea48a5bcd0442d5505ae5b6334',
  
  // MoC V2 Core contract (for RIF collateral)
  MOC_V2_CORE: '0xA27024Ed70035E46dba712609fc2Afa1c97aA36A',
  
  // RIF Name Service registry (reverse: <addr>.addr.reverse) — dev.rootstock.io RNS guide
  RNS_REGISTRY_MAINNET: '0xcb868aeabd31e2b66f74e9a55cf064abb31a4ad5',
  RNS_REGISTRY_TESTNET: '0x7d284aaac6e925aad802a53c0c69efe3764597b8',

  // RSK Testnet (BTC Vault analyser)
  RSK_TESTNET_RPC: 'https://public-node.testnet.rsk.co',
  RSK_TESTNET_BLOCKSCOUT_V2: 'https://rootstock-testnet.blockscout.com/api/v2',
  
  // RSK Mainnet (BTC Vault mainnet analyser — use with ROOTSTOCK_RPC)
  RSK_MAINNET_BLOCKSCOUT_V2: 'https://rootstock.blockscout.com/api/v2',

  // BTC Vault Contracts (RSK Testnet)
  BTC_VAULT_RBTC_ASYNC_VAULT_PROXY: '0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1',

  /** User-facing mainnet vault proxy; full deployment: {@link BTC_VAULT_MAINNET_CONTRACTS} */
  BTC_VAULT_MAINNET_ROOTSTOCK_VAULT_PROXY: BTC_VAULT_MAINNET_CONTRACTS.RootstockBTCVaultProxy,

  /** EIP-155 ids for `https://bens.services.blockscout.com/api/v1/{id}/...` */
  ROOTSTOCK_MAINNET_CHAIN_ID: 30,
  ROOTSTOCK_TESTNET_CHAIN_ID: 31,
  /** Blockscout BENS microservice (names indexed per chain) */
  BENS_API_V1_BASE: 'https://bens.services.blockscout.com/api/v1',
  
  // Refresh interval in milliseconds (120 seconds)
  REFRESH_INTERVAL: 120000,
  
  // Client version for version checking (uses git commit hash)
  CLIENT_VERSION: import.meta.env.VITE_GIT_COMMIT_HASH || 'unknown',
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
  'function calcCtargemaCA() view returns (uint256)',
  'function getCglb() view returns (uint256)',
] as const

// BTC Vault events: testnet async vault + mainnet RootstockBTCVault (epoch-based)
export const BTC_VAULT_ABI = [
  'event DepositRequest(address indexed user, address indexed receiver, uint256 amount, address indexed token, uint256 shares)',
  'event NativeDepositRequested(address indexed user, address indexed receiver, uint256 amount, uint256 shares)',
  'event DepositClaimed(address indexed user, address indexed receiver, address indexed token, uint256 amount, uint256 shares, uint256 epochId)',
  'event DepositRequestCancelled(address indexed user, address indexed receiver, uint256 amount, uint256 shares)',
  'event NativeDepositRequestCancelled(address indexed user, address indexed receiver, uint256 amount, uint256 shares)',
  'event RedeemRequest(address indexed user, address indexed receiver, uint256 shares, address indexed token, uint256 amount)',
  'event RedeemClaimed(address indexed user, address indexed receiver, address indexed token, uint256 shares, address indexed assetToken, uint256 amount, uint256 epochId)',
  'event RedeemRequestCancelled(address indexed user, address indexed receiver, uint256 shares, uint256 amount)',
  'event SyntheticYieldApplied(uint256 indexed epochId, address indexed caller, uint256 amount)',
  // Mainnet RootstockBTCVault (see Blockscout decoded names)
  'event DepositRequested(address indexed owner, uint256 indexed epochId, uint256 assets, bool isNative)',
  'event DepositClaimed(address indexed caller, address indexed receiver, uint256 indexed epochId, uint256 assets, uint256 shares)',
  'event DepositRequestCancelled(address indexed owner, uint256 indexed epochId, uint256 assets, bool refundedNative)',
] as const
