/**
 * Shared RPC client for JSON-RPC calls (Rootstock).
 * Uses proxy in production for CORS; direct endpoints in dev.
 * Used by MintRedeemAnalyser and VaultDepositWithdrawAnalyser.
 */
import { CONFIG } from '../config'

/**
 * Make a JSON-RPC call to Rootstock. Tries proxy first in production, then direct endpoints.
 * Falls back through endpoints on failure (CORS, 404, 410, etc.).
 * @param method - JSON-RPC method (e.g. 'eth_blockNumber')
 * @param params - JSON-RPC params array
 * @param rpcEndpoint - Optional override (e.g. CONFIG.RSK_TESTNET_RPC for testnet). Must be in api/rpc whitelist for proxy.
 */
export async function rpcCall<T = unknown>(
  method: string,
  params: unknown[],
  rpcEndpoint?: string
): Promise<T> {
  const primaryRpcEndpoint = rpcEndpoint ?? CONFIG.ROOTSTOCK_RPC ?? 'https://public-node.rsk.co'
  const fallbackEndpoints =
    rpcEndpoint != null
      ? []
      : CONFIG.ROOTSTOCK_RPC_ALTERNATIVES ?? [
          'https://public-node.rsk.co',
          'https://rsk.publicnode.com',
        ]

  const isDev = import.meta.env.DEV
  const endpointsToTry = isDev
    ? [primaryRpcEndpoint, ...fallbackEndpoints]
    : [
        `/api/rpc?target=${encodeURIComponent(primaryRpcEndpoint)}`,
        ...fallbackEndpoints.map((ep) => `/api/rpc?target=${encodeURIComponent(ep)}`),
        primaryRpcEndpoint,
        ...fallbackEndpoints,
      ]

  let lastError: Error | null = null

  for (const targetUrl of endpointsToTry) {
    const isDirectRpc = !targetUrl.startsWith('/api/')

    try {
      const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (!isDirectRpc) {
        requestHeaders['X-Client-Version'] = CONFIG.CLIENT_VERSION || 'unknown'
      }

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
      })

      if (response.status === 410 || response.status === 404) {
        if (response.status === 404 && !isDirectRpc) {
          lastError = new Error("RPC proxy unavailable (run 'npm run dev' for vercel dev with API)")
          continue
        }
        lastError = new Error(`RPC endpoint unavailable: ${response.status} ${response.statusText}`)
        continue
      }

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          lastError = new Error(`RPC error: ${response.status} ${response.statusText}`)
          continue
        }
        throw new Error(`RPC server error: ${response.status} ${response.statusText}`)
      }

      const responseText = await response.text()
      if (!responseText?.trim()) {
        lastError = new Error('RPC returned empty response')
        continue
      }

      const data = JSON.parse(responseText)
      if (data.error) {
        throw new Error(data.error.message || 'RPC error')
      }

      return data.result as T
    } catch (rpcError) {
      const isCorsError =
        rpcError instanceof TypeError &&
        (rpcError.message.includes('CORS') ||
          rpcError.message.includes('Failed to fetch') ||
          rpcError.message.includes('network'))

      if (isCorsError && isDirectRpc) {
        lastError = rpcError as Error
        continue
      }

      if (
        rpcError instanceof SyntaxError ||
        (rpcError instanceof Error &&
          (rpcError.message.includes('fetch') || rpcError.message.includes('network')))
      ) {
        lastError = rpcError as Error
        continue
      }
      throw rpcError
    }
  }

  throw new Error(`Failed to fetch RPC data from all endpoints: ${lastError?.message || 'Unknown error'}`)
}
