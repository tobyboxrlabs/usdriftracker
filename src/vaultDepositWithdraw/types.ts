export interface VaultTransaction {
  time: Date
  hash: string
  status: 'Success' | 'Failed'
  type: 'Deposit' | 'Withdraw'
  /** Amount of USDRIF deposited/withdrawn (assets), human-readable */
  amount: string
  /** owner for deposits, receiver for withdrawals */
  receiver: string
  blockNumber: number
}
