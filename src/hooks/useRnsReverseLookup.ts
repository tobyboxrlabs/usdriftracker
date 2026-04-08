import { useEffect, useMemo, useState } from 'react'
import { bensLookupMany } from '../utils/bensLookup'
import { reverseResolveRnsMany } from '../utils/rnsReverse'

export type RnsLabelMap = Readonly<Record<string, string>>

/**
 * Resolve human-readable names for wallet addresses when an analyser is expanded.
 * Order: **Blockscout BENS** (`GET .../api/v1/{chainId}/addresses:lookup?...`) then **on-chain RNS**
 * for any address BENS does not return (indexing gap or no subgraph name).
 *
 * Keys are lowercased hex addresses; values are names (e.g. `foo.rsk`).
 */
export function useRnsReverseLookup(
  addresses: string[],
  chainId: number,
  rpcUrl: string,
  registryAddress: string,
  enabled: boolean
): RnsLabelMap {
  const sortedKey = useMemo(() => {
    const u = new Set<string>()
    for (const a of addresses) {
      const t = a?.trim().toLowerCase()
      if (t && /^0x[a-f0-9]{40}$/.test(t)) u.add(t)
    }
    return [...u].sort().join(',')
  }, [addresses])

  const [labels, setLabels] = useState<RnsLabelMap>({})

  useEffect(() => {
    if (!enabled || !sortedKey) {
      setLabels({})
      return
    }

    let cancelled = false
    const list = sortedKey.split(',').filter(Boolean)

    ;(async () => {
      const bens = await bensLookupMany(chainId, list)
      if (cancelled) return
      const missing = list.filter((a) => !bens.has(a))
      const onchain =
        missing.length > 0 ? await reverseResolveRnsMany(rpcUrl, registryAddress, missing) : new Map<string, string>()
      if (cancelled) return
      setLabels({
        ...Object.fromEntries(bens),
        ...Object.fromEntries(onchain),
      })
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, sortedKey, chainId, rpcUrl, registryAddress])

  return labels
}
