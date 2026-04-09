import type { BTCVaultTransaction } from './types'

/** Show Receiver only when some row has a receiver distinct from user (or user missing but receiver set). */
export function needsDistinctReceiverColumn(transactions: BTCVaultTransaction[]): boolean {
  return transactions.some((tx) => {
    const u = tx.user?.trim().toLowerCase() || ''
    const r = tx.receiver?.trim().toLowerCase() || ''
    if (!r) return false
    return !u || u !== r
  })
}
