import { ethers } from 'ethers'
import { CONFIG } from '../config'
import { logger } from '../utils/logger'

/**
 * JsonRpcProvider that proxies requests through `/api/rpc` (production) with client version header.
 */
export class ProxyJsonRpcProvider extends ethers.JsonRpcProvider {
  private proxyUrl: string

  constructor(targetEndpoint: string) {
    const proxyUrl = `/api/rpc?target=${encodeURIComponent(targetEndpoint)}`
    super(proxyUrl)
    this.proxyUrl = proxyUrl
  }

  async _send(
    payload: ethers.JsonRpcPayload | ethers.JsonRpcPayload[]
  ): Promise<Array<ethers.JsonRpcResult>> {
    const payloads = Array.isArray(payload) ? payload : [payload]

    const results = await Promise.all(
      payloads.map(async (p) => {
        try {
          const response = await fetch(this.proxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Client-Version': CONFIG.CLIENT_VERSION,
            },
            body: JSON.stringify(p),
          })

          if (!response.ok) {
            const errorText = await response.text()
            logger.rpc.error(`RPC proxy error ${response.status}:`, errorText.substring(0, 200))

            if (response.status === 410) {
              try {
                const errorData = JSON.parse(errorText)
                if (errorData.code === 'OUTDATED_CLIENT') {
                  logger.rpc.warn('Client version outdated - stopping polling')
                  throw new Error('OUTDATED_CLIENT')
                }
              } catch {
                if (response.status === 410) {
                  logger.rpc.warn('Received 410 Gone - client may be outdated')
                  throw new Error('OUTDATED_CLIENT')
                }
              }
            }

            throw new Error(`RPC proxy error: ${response.status} - ${errorText.substring(0, 100)}`)
          }

          const result = await response.json()
          if (result.error) {
            logger.rpc.error('JSON-RPC error:', result.error)
          }
          return result
        } catch (fetchError) {
          logger.rpc.error('Fetch error:', fetchError)
          throw fetchError
        }
      })
    )

    return results as Array<ethers.JsonRpcResult>
  }
}
