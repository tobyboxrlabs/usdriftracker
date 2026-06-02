/** MoC protocol precision (1e18). */
export const MOC_PRECISION = 10n ** 18n

/**
 * Hand-rolled USDRIF mintable per MocBaseBucket (post V3):
 *   lckACemaAdjusted = nACcb × PREC − ctargemaCA × lckAC
 *   mintable = (lckACemaAdjusted × pACtp) / ((ctargemaTP − 1) × PREC)
 */
export function calcHandRolledUsdrifMintable(
  nACcb: bigint,
  ctargemaCA: bigint,
  lckAC: bigint,
  ctargemaTP: bigint,
  pACtp: bigint
): bigint {
  const lckACemaAdjusted = nACcb * MOC_PRECISION - ctargemaCA * lckAC
  if (lckACemaAdjusted <= 0n) return 0n
  const denom = (ctargemaTP - MOC_PRECISION) * MOC_PRECISION
  if (denom <= 0n) return 0n
  const raw = (lckACemaAdjusted * pACtp) / denom
  return raw < 0n ? 0n : raw
}
