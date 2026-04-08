import type { RnsLabelMap } from '../hooks/useRnsReverseLookup'
import { sanitizeRnsDisplayName } from '../utils/rnsDisplayName'

export interface AddressLinkWithRnsProps {
  href: string
  address: string
  rnsByAddressLower: RnsLabelMap
  /** When false, show full address if no RNS (default). When true, always shorten when no RNS. */
  shortenIfNoRns?: boolean
}

/**
 * Block explorer link: shows RNS name when resolved, else address (shortened optionally).
 */
export function AddressLinkWithRns({
  href,
  address,
  rnsByAddressLower,
  shortenIfNoRns = false,
}: AddressLinkWithRnsProps) {
  const lower = address.trim().toLowerCase()
  const rnsRaw = rnsByAddressLower[lower]
  const rns = rnsRaw ? sanitizeRnsDisplayName(rnsRaw) : undefined
  const display =
    rns ??
    (shortenIfNoRns ? `${address.slice(0, 6)}…${address.slice(-4)}` : address)

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={rns ? `${rns} (${address})` : address}>
      {display}
    </a>
  )
}
