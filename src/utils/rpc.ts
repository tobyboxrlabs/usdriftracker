/**
 * Shared RPC client for JSON-RPC (Rootstock).
 * Uses proxy in production for CORS; direct endpoints in dev.
 * Used by MintRedeemAnalyser and VaultDepositWithdrawAnalyser.
 */
import { CONFIG } from '../config'
import { isTransientHttpStatus, isTransientNetworkError, sleep } from './asyncRetry'

const RPC_ATTEMPTS_PER_ENDPOINT = 3
const RPC_BACKOFF_BASE_MS = 450

/**
 * Make a JSON-RPC call to Rootstock. Tries proxy first in production, then direct endpoints.
 * Falls back through endpoints on failure (CORS, 404, 410, etc.).
 * Retries transient HTTP/network errors per endpoint before trying the next.
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

    endpointAttempts: for (let attempt = 0; attempt < RPC_ATTEMPTS_PER_ENDPOINT; attempt++) {
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

        if (response.status === 410) {
          lastError = new Error(`RPC endpoint unavailable: ${response.status} ${response.statusText}`)
          break endpointAttempts
        }

        if (response.status === 404 && !isDirectRpc) {
          lastError = new Error("RPC proxy unavailable (run 'npm run dev' for vercel dev with API)")
          break endpointAttempts
        }

        if (response.status === 404 && isDirectRpc) {
          lastError = new Error(`RPC endpoint unavailable: ${response.status} ${response.statusText}`)
          break endpointAttempts
        }

        if (!response.ok) {
          if (isTransientHttpStatus(response.status) && attempt < RPC_ATTEMPTS_PER_ENDPOINT - 1) {
            await sleep(RPC_BACKOFF_BASE_MS * Math.pow(2, attempt))
            continue endpointAttempts
          }
          if (response.status >= 400 && response.status < 500) {
            lastError = new Error(`RPC error: ${response.status} ${response.statusText}`)
            break endpointAttempts
          }
          throw new Error(`RPC server error: ${response.status} ${response.statusText}`)
        }

        const responseText = await response.text()
        if (!responseText?.trim()) {
          if (attempt < RPC_ATTEMPTS_PER_ENDPOINT - 1) {
            await sleep(RPC_BACKOFF_BASE_MS * Math.pow(2, attempt))
            continue endpointAttempts
          }
          lastError = new Error('RPC returned empty response')
          break endpointAttempts
        }

        const data = JSON.parse(responseText)
        if (data.error) {
          throw new Error(data.error.message || 'RPC error')
        }

        return data.result as T
      } catch (rpcError) {
        if (isTransientNetworkError(rpcError) && attempt < RPC_ATTEMPTS_PER_ENDPOINT - 1) {
          await sleep(RPC_BACKOFF_BASE_MS * Math.pow(2, attempt))
          continue endpointAttempts
        }

        const isCorsError =
          rpcError instanceof TypeError &&
          (rpcError.message.includes('CORS') ||
            rpcError.message.includes('Failed to fetch') ||
            rpcError.message.includes('network'))

        if (isCorsError && isDirectRpc) {
          lastError = rpcError as Error
          break endpointAttempts
        }

        if (
          rpcError instanceof SyntaxError ||
          (rpcError instanceof Error &&
            (rpcError.message.includes('fetch') || rpcError.message.includes('network')))
        ) {
          lastError = rpcError as Error
          break endpointAttempts
        }
        throw rpcError
      }
    }
  }

  throw new Error(
    `Failed to fetch RPC data from all endpoints (${endpointsToTry.length} tried). Last error: ${lastError?.message || 'Unknown error'}.`
  )
}
