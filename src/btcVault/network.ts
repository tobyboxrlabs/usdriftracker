import { CONFIG } from '../config'
import type { BTCVaultChain, BtcVaultNetwork } from './types'

export const BTC_VAULT_CHAIN: Record<BTCVaultChain, BtcVaultNetwork> = {
  testnet: {
    blockscoutV2Api: CONFIG.RSK_TESTNET_BLOCKSCOUT_V2,
    vaultAddressLower: CONFIG.BTC_VAULT_RBTC_ASYNC_VAULT_PROXY.toLowerCase(),
    rpcUrl: CONFIG.RSK_TESTNET_RPC,
    explorerOrigin: 'https://rootstock-testnet.blockscout.com',
    excelBaseName: 'btc-vault-testnet-transactions',
    excelSheet: 'BTC Vault (testnet)',
  },
  mainnet: {
    blockscoutV2Api: CONFIG.RSK_MAINNET_BLOCKSCOUT_V2,
    vaultAddressLower: CONFIG.BTC_VAULT_MAINNET_ROOTSTOCK_VAULT_PROXY.toLowerCase(),
    rpcUrl: CONFIG.ROOTSTOCK_RPC,
    explorerOrigin: 'https://rootstock.blockscout.com',
    excelBaseName: 'btc-vault-mainnet-transactions',
    excelSheet: 'BTC Vault (mainnet)',
  },
}
