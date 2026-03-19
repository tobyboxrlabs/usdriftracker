/**
 * Shared amount formatting utilities for token/currency display.
 * Used across App, MintRedeemAnalyser, VaultDepositWithdrawAnalyser, BTCVaultAnalyser.
 */

/**
 * Format BigInt amount with specified decimals.
 * Returns human-readable string representation (e.g. "1234.56" for 18 decimals).
 */
export function formatAmount(amount: bigint, decimals: number | bigint = 18): string {
  if (amount === 0n) return '0'

  const decimalsNum = Number(decimals)
  if (decimalsNum < 0 || decimalsNum > 255) {
    throw new Error(`Invalid decimals value: ${decimalsNum}`)
  }

  const factor = 10n ** BigInt(decimalsNum)
  const whole = amount / factor
  const frac = amount % factor

  if (frac === 0n) return whole.toString()

  const fracStr = frac.toString().padStart(decimalsNum, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

/**
 * Format a numeric string for display with locale-aware formatting.
 * Handles NaN by returning the original string.
 */
export function formatAmountDisplay(amount: string, decimals: number = 0): string {
  const numValue = parseFloat(amount)
  if (isNaN(numValue)) return amount
  return numValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
