/** Which Rootstock network this analyser uses (shared UI + decode logic). */
export type BTCVaultChain = 'testnet' | 'mainnet'

export interface BTCVaultTransaction {
  time: Date
  hash: string
  status: 'Requested' | 'Claimed' | 'Cancelled'
  type: 'Deposit Request' | 'Deposit Claimed' | 'Redeem Request' | 'Redeem Claimed' | 'Yield Applied'
  user: string
  receiver: string
  amount: string
  shares: string
  token: string
  assetToken: string
  epochId?: number
  blockNumber: number
}

export interface BtcVaultNetwork {
  blockscoutV2Api: string
  vaultAddressLower: string
  rpcUrl: string
  explorerOrigin: string
  excelBaseName: string
  excelSheet: string
}
