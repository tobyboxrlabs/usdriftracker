import { ethers } from 'ethers'
import { CONFIG } from '../config'
import { withBackoff } from '../utils/asyncRetry'
import { logger } from '../utils/logger'
import { ProxyJsonRpcProvider } from './proxyJsonRpcProvider'

export async function resolveWorkingProvider(
  cacheRef: { current: ethers.JsonRpcProvider | null }
): Promise<ethers.JsonRpcProvider | null> {
  if (cacheRef.current) {
    try {
      await cacheRef.current.getBlockNumber()
      return cacheRef.current
    } catch {
      logger.tokenData.warn('Cached provider failed, creating new instance')
      cacheRef.current = null
    }
  }

  const endpoints = [CONFIG.ROOTSTOCK_RPC, ...(CONFIG.ROOTSTOCK_RPC_ALTERNATIVES || [])]
  const isDev = import.meta.env.DEV
  const useSameOriginRpcProxy = typeof window !== 'undefined' && !import.meta.env.VITEST

  if (useSameOriginRpcProxy) {
    for (const endpoint of endpoints) {
      try {
        const provider = await withBackoff(
          async () => {
            const p = new ProxyJsonRpcProvider(endpoint)
            await p.getBlockNumber()
            return p
          },
          { maxAttempts: 3, baseDelayMs: 400 }
        )
        logger.rpc.info(`Using RPC proxy: ${endpoint}`)
        cacheRef.current = provider
        return provider
      } catch {
        continue
      }
    }
    logger.rpc.error(
      'Same-origin /api/rpc failed for all endpoints (restart `npm run dev` or use `npm run dev:vercel`). Skipping direct RPC in the browser to avoid CORS errors.'
    )
    return null
  }

  for (const endpoint of endpoints) {
    try {
      const provider = await withBackoff(
        async () => {
          const p = new ethers.JsonRpcProvider(endpoint)
          await p.getBlockNumber()
          return p
        },
        { maxAttempts: 3, baseDelayMs: 400 }
      )
      logger.rpc.info(`Using direct RPC: ${endpoint}`)
      cacheRef.current = provider
      return provider
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('CORS') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('network') ||
          error.message.includes('ERR_FAILED') ||
          error.message.includes('ERR_CONNECTION'))
      ) {
        continue
      }
      if (!isDev) {
        logger.rpc.warn(`RPC endpoint ${endpoint} failed, trying next...`, error)
      }
      continue
    }
  }

  logger.rpc.error('All RPC endpoints failed')
  return null
}
