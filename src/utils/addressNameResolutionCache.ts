/**
 * Process-wide in-memory cache for BENS + on-chain RNS reverse lookups.
 * Survives component unmount/remount; resets when the page reloads.
 * Negative results (no name) are cached only after a successful API/RPC response.
 */

const bensCache = new Map<string, string | null>()
const rnsCache = new Map<string, string | null>()

export function bensLookupCacheKey(chainId: number, baseUrl: string, addressLower: string): string {
  return `${chainId}\0${baseUrl.replace(/\/$/, '')}\0${addressLower}`
}

export function rnsReverseCacheKey(rpcUrl: string, registryAddress: string, addressLower: string): string {
  return `${rpcUrl.replace(/\/$/, '')}\0${registryAddress.trim().toLowerCase()}\0${addressLower}`
}

/** `undefined` = not cached; `null` = cached miss (resolved: no name). */
export function getBensCached(key: string): string | null | undefined {
  if (!bensCache.has(key)) return undefined
  return bensCache.get(key)!
}

export function setBensCached(key: string, value: string | null): void {
  bensCache.set(key, value)
}

export function getRnsCached(key: string): string | null | undefined {
  if (!rnsCache.has(key)) return undefined
  return rnsCache.get(key)!
}

export function setRnsCached(key: string, value: string | null): void {
  rnsCache.set(key, value)
}

/** Tests / dev: reset global name caches. */
export function clearAddressNameResolutionCaches(): void {
  bensCache.clear()
  rnsCache.clear()
}
