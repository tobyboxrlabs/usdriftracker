/**
 * RNS reverse resolution (EIP-181-style): address → .rsk name via registry + resolver.
 * @see https://dev.rootstock.io/developers/integrate/rns/smart-contract/
 */
import { ethers } from 'ethers'
import { getRnsCached, rnsReverseCacheKey, setRnsCached } from './addressNameResolutionCache'
import { rpcCall } from './rpc'

const REGISTRY_IFACE = new ethers.Interface(['function resolver(bytes32 node) view returns (address)'])
const RESOLVER_IFACE = new ethers.Interface(['function name(bytes32 node) view returns (string)'])

function reverseNode(address: string): string {
  const normalized = ethers.getAddress(address)
  return ethers.namehash(`${normalized.slice(2).toLowerCase()}.addr.reverse`)
}

/**
 * Resolve a single address to its primary RNS name, or null if none / error.
 */
export async function reverseResolveRns(
  rpcUrl: string,
  registryAddress: string,
  address: string
): Promise<string | null> {
  try {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())) return null
    const lower = address.trim().toLowerCase()
    const ck = rnsReverseCacheKey(rpcUrl, registryAddress, lower)
    const hit = getRnsCached(ck)
    if (hit !== undefined) return hit

    const node = reverseNode(address)
    const resolverCalldata = REGISTRY_IFACE.encodeFunctionData('resolver', [node])
    const resolverHex = await rpcCall<string>(
      'eth_call',
      [{ to: registryAddress, data: resolverCalldata }, 'latest'],
      rpcUrl
    )
    const resolverAddr = REGISTRY_IFACE.decodeFunctionResult('resolver', resolverHex)[0]
    if (!resolverAddr || resolverAddr === ethers.ZeroAddress) {
      setRnsCached(ck, null)
      return null
    }

    const nameCalldata = RESOLVER_IFACE.encodeFunctionData('name', [node])
    const nameHex = await rpcCall<string>('eth_call', [{ to: resolverAddr, data: nameCalldata }, 'latest'], rpcUrl)
    const name = RESOLVER_IFACE.decodeFunctionResult('name', nameHex)[0]
    if (typeof name !== 'string' || !name.trim()) {
      setRnsCached(ck, null)
      return null
    }
    const trimmed = name.trim()
    setRnsCached(ck, trimmed)
    return trimmed
  } catch {
    return null
  }
}

const BATCH_CONCURRENCY = 5

/**
 * Reverse-resolve many addresses (deduped, lowercase keys). Only entries with a name are stored.
 */
export async function reverseResolveRnsMany(
  rpcUrl: string,
  registryAddress: string,
  addresses: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(addresses.map((a) => a?.trim().toLowerCase()).filter((a) => a && /^0x[a-f0-9]{40}$/.test(a)))]
  const out = new Map<string, string>()

  for (let i = 0; i < unique.length; i += BATCH_CONCURRENCY) {
    const slice = unique.slice(i, i + BATCH_CONCURRENCY)
    const results = await Promise.all(
      slice.map(async (lower) => {
        const name = await reverseResolveRns(rpcUrl, registryAddress, lower)
        return name ? ([lower, name] as const) : null
      })
    )
    for (const row of results) {
      if (row) out.set(row[0], row[1])
    }
  }

  return out
}
