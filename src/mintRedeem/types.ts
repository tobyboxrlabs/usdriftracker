export interface MintRedeemTransaction {
  time: Date
  hash: string
  status: 'Success' | 'Failed'
  type: 'USDRIF Mint' | 'USDRIF Redeem' | 'RifPro Mint' | 'RifPro Redeem'
  amountMintedRedeemed: string
  receiver: string
  amountSentReceived: string
  returned: boolean
  valueReturned: string
  tokenReturned: string
  blockNumber: number
}
