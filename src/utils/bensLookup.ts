/**
 * Blockscout BENS (Blockscout ENS) address→name index (GET).
 * @see https://docs.blockscout.com/setup/microservices/blockscout-ens-bens-name-service-integration
 *
 * Rootstock mainnet = 30, testnet = 31 in BENS URLs (`/api/v1/{chainId}/...`).
 */
import { CONFIG } from '../config'
import { parseEvmAddressOrNull } from './address'
import {
  bensLookupCacheKey,
  getBensCached,
  setBensCached,
} from './addressNameResolutionCache'
import { sanitizeRnsDisplayName } from './rnsDisplayName'

export interface BensAddressItem {
  name: string
  resolved_address?: { hash?: string }
  protocol?: { id?: string; short_name?: string }
}

interface BensLookupResponse {
  items?: BensAddressItem[]
}

const BATCH = 5

function pickBensDisplayName(items: BensAddressItem[] | undefined): string | null {
  if (!items?.length) return null
  const rsk = items.find((i) => i.name.toLowerCase().endsWith('.rsk'))
  const raw = rsk
    ? rsk.name
    : (items.find((i) => i.protocol?.short_name?.toLowerCase() === 'rns') ?? items[0]).name
  return sanitizeRnsDisplayName(raw)
}

/**
 * Names that resolve to `address` per BENS index (if any).
 */
export async function bensLookupNamesForAddress(
  chainId: number,
  address: string,
  baseUrl: string = CONFIG.BENS_API_V1_BASE
): Promise<string | null> {
  try {
    const addr = parseEvmAddressOrNull(address)
    if (!addr) return null
    const lower = addr.toLowerCase()
    const b = baseUrl.replace(/\/$/, '')
    const ck = bensLookupCacheKey(chainId, b, lower)
    const hit = getBensCached(ck)
    if (hit !== undefined) {
      if (hit === null) return null
      const safe = sanitizeRnsDisplayName(hit)
      if (safe === null) {
        setBensCached(ck, null)
        return null
      }
      return safe
    }

    const params = new URLSearchParams({
      resolved_to: 'true',
      address: addr,
      owned_by: 'true',
      only_highest_rank: 'true',
    })
    const url = `${b}/${chainId}/addresses:lookup?${params.toString()}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as BensLookupResponse
    const name = pickBensDisplayName(data.items)
    setBensCached(ck, name)
    return name
  } catch {
    return null
  }
}

/**
 * Batch BENS lookups. Keys are lowercased addresses.
 */
export async function bensLookupMany(
  chainId: number,
  addresses: string[],
  baseUrl?: string
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      addresses
        .map((a) => a?.trim().toLowerCase())
        .filter((a): a is string => Boolean(a && /^0x[a-f0-9]{40}$/.test(a)))
    ),
  ]
  const out = new Map<string, string>()
  const b = baseUrl ?? CONFIG.BENS_API_V1_BASE

  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH)
    const results = await Promise.all(
      slice.map(async (lower) => {
        const name = await bensLookupNamesForAddress(chainId, lower, b)
        return name ? ([lower, name] as const) : null
      })
    )
    for (const row of results) {
      if (row) out.set(row[0], row[1])
    }
  }

  return out
}
