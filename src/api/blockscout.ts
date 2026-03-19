/**
 * Shared Blockscout API utilities: rate limiter and fetch functions.
 * Used by MintRedeemAnalyser (API v1), VaultDepositWithdrawAnalyser (API v2 mainnet),
 * and BTCVaultAnalyser (API v2 testnet).
 */

// ============================================================================
// API v1 types (MintRedeemAnalyser)
// ============================================================================

export interface BlockscoutLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  blockHash: string
  logIndex: string
  removed: boolean
}

export interface BlockscoutResponse {
  status: string
  message: string
  result: BlockscoutLog[]
}

// ============================================================================
// API v2 types (VaultDepositWithdrawAnalyser, BTCVaultAnalyser)
// ============================================================================

export interface BlockscoutV2Log {
  address: { hash: string }
  block_number: number
  block_timestamp: string
  data: string
  decoded: {
    method_call: string
    parameters: Array<{ name: string; type: string; value: string }>
  } | null
  topics: (string | null)[]
  transaction_hash: string
  index: number
}

export interface BlockscoutV2Response {
  items: BlockscoutV2Log[]
  next_page_params: {
    block_number?: number
    index?: number
    items_count?: number
  } | null
}

// ============================================================================
// Rate Limiter (shared across all Blockscout calls)
// ============================================================================

class BlockscoutRateLimiter {
  private lastCallTime = 0
  private callQueue: Array<() => void> = []
  private isProcessing = false
  private consecutiveFailures = 0
  private readonly MIN_DELAY = 200
  private readonly MAX_DELAY = 5000

  async throttle(): Promise<void> {
    return new Promise((resolve) => {
      this.callQueue.push(resolve)
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.callQueue.length === 0) return
    this.isProcessing = true
    while (this.callQueue.length > 0) {
      const resolve = this.callQueue.shift()!
      const adaptiveDelay = Math.min(
        this.MIN_DELAY * Math.pow(2, Math.min(this.consecutiveFailures, 4)),
        this.MAX_DELAY
      )
      const timeSinceLastCall = Date.now() - this.lastCallTime
      const delayNeeded = Math.max(adaptiveDelay - timeSinceLastCall, 0)
      if (delayNeeded > 0) await new Promise((r) => setTimeout(r, delayNeeded))
      this.lastCallTime = Date.now()
      resolve()
    }
    this.isProcessing = false
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
  }

  recordFailure(): void {
    this.consecutiveFailures++
  }
}

const rateLimiter = new BlockscoutRateLimiter()

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.name === 'AbortError' ||
    /timeout|Failed to fetch|network|ERR_CONNECTION|ERR_TIMED_OUT|ERR_/i.test(err.message)
  )
}

// ============================================================================
// API v1: fetchLogs (topic0 filter)
// ============================================================================

const BLOCKSCOUT_API_V1 = 'https://rootstock.blockscout.com/api'
const FETCH_TIMEOUT = 30000

export async function fetchLogsV1(
  address: string,
  fromBlock: number,
  toBlock: number,
  topic0: string,
  retryCount = 0
): Promise<BlockscoutLog[]> {
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    throw new Error(`Invalid fromBlock: ${fromBlock}. Must be a non-negative integer.`)
  }
  if (!Number.isInteger(toBlock) || toBlock < 0) {
    throw new Error(`Invalid toBlock: ${toBlock}. Must be a non-negative integer.`)
  }
  if (toBlock < fromBlock) {
    throw new Error(`Invalid block range: toBlock (${toBlock}) must be >= fromBlock (${fromBlock}).`)
  }

  await rateLimiter.throttle()

  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    address,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    topic0,
    page: '1',
    offset: '10000',
  })
  const url = `${BLOCKSCOUT_API_V1}?${params.toString()}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
    } catch (fetchError) {
      clearTimeout(timeoutId)
      if (isNetworkError(fetchError) && retryCount < 3) {
        rateLimiter.recordFailure()
        await new Promise((r) => setTimeout(r, Math.min(2000 * Math.pow(2, retryCount), 10000)))
        return fetchLogsV1(address, fromBlock, toBlock, topic0, retryCount + 1)
      }
      if (isNetworkError(fetchError)) {
        throw new Error(
          'Blockscout API request timed out or network error. The API may be temporarily unavailable. Please check your internet connection and try again later.'
        )
      }
      throw fetchError
    }

    if (response.status === 429) {
      rateLimiter.recordFailure()
      if (retryCount < 3) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, retryCount), 5000)))
        return fetchLogsV1(address, fromBlock, toBlock, topic0, retryCount + 1)
      }
      throw new Error(
        'Blockscout API rate limited. Too many requests. Please try again later or reduce the lookback period.'
      )
    }

    if (!response.ok) {
      rateLimiter.recordFailure()
      if (response.status === 503) {
        throw new Error('Blockscout API is temporarily unavailable (503). Please try again in a few moments.')
      }
      throw new Error(`Blockscout API error (${response.status}): ${response.statusText}. Please try again later.`)
    }

    rateLimiter.recordSuccess()
    const text = await response.text()
    if (!text?.trim()) return []

    const contentType = response.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      rateLimiter.recordFailure()
      throw new Error(`Blockscout API returned non-JSON response: ${text.substring(0, 200)}`)
    }

    try {
      const data = JSON.parse(text) as BlockscoutResponse
      if (data.status !== '1') {
        if (
          data.status === '0' &&
          (data.message?.toLowerCase().includes('no logs found') || data.message?.toLowerCase().includes('no logs'))
        ) {
          return []
        }
        rateLimiter.recordFailure()
        throw new Error(
          `Blockscout API returned an error (status: ${data.status}). ${data.message || 'Unknown error'}. Please try again later or reduce the lookback period.`
        )
      }
      return data.result || []
    } catch (parseError) {
      rateLimiter.recordFailure()
      throw new Error(
        `Failed to parse Blockscout API response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}. Response: ${text.substring(0, 200)}`
      )
    }
  } catch (fetchError) {
    rateLimiter.recordFailure()
    if (retryCount < 3 && isNetworkError(fetchError)) {
      await new Promise((r) => setTimeout(r, Math.min(2000 * Math.pow(2, retryCount), 10000)))
      return fetchLogsV1(address, fromBlock, toBlock, topic0, retryCount + 1)
    }
    throw fetchError
  }
}

// ============================================================================
// API v2: fetchLogs (paginated, baseUrl for mainnet vs testnet)
// ============================================================================

export async function fetchLogsV2(
  baseUrl: string,
  address: string,
  fromBlock: number,
  toBlock: number,
  retryCount = 0
): Promise<BlockscoutV2Log[]> {
  await rateLimiter.throttle()
  const allLogs: BlockscoutV2Log[] = []
  let nextPageParams: BlockscoutV2Response['next_page_params'] = null
  let pageCount = 0
  const MAX_PAGES = 100

  while (pageCount < MAX_PAGES) {
    try {
      let url = `${baseUrl}/addresses/${address}/logs`
      const params = new URLSearchParams()
      if (nextPageParams?.index !== undefined) params.append('index', String(nextPageParams.index))
      if (nextPageParams?.items_count !== undefined) params.append('items_count', String(nextPageParams.items_count))
      if (nextPageParams?.block_number !== undefined) params.append('block_number', String(nextPageParams.block_number))
      // Note: Rootstock Blockscout returns 422 when filter[from_block]/filter[to_block] are sent.
      // Rely on client-side filtering by block_number instead.
      if (params.toString()) url += '?' + params.toString()

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
      let response: Response
      try {
        response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
      } catch (fetchError) {
        clearTimeout(timeoutId)
        if (isNetworkError(fetchError) && retryCount < 3) {
          rateLimiter.recordFailure()
          await new Promise((r) => setTimeout(r, Math.min(2000 * Math.pow(2, retryCount), 10000)))
          return fetchLogsV2(baseUrl, address, fromBlock, toBlock, retryCount + 1)
        }
        throw fetchError
      }

      if (response.status === 429 && retryCount < 3) {
        rateLimiter.recordFailure()
        await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, retryCount), 5000)))
        return fetchLogsV2(baseUrl, address, fromBlock, toBlock, retryCount + 1)
      }
      if (!response.ok) {
        rateLimiter.recordFailure()
        if (response.status === 503) {
          throw new Error('Blockscout API v2 is temporarily unavailable (503). Please try again in a few moments.')
        }
        throw new Error(`Blockscout API v2 error (${response.status}): ${response.statusText}. Please try again later.`)
      }
      rateLimiter.recordSuccess()

      const text = await response.text()
      if (!text?.trim()) break

      if (!response.headers.get('content-type')?.includes('application/json')) {
        rateLimiter.recordFailure()
        throw new Error(`Blockscout API v2 returned non-JSON response: ${text.substring(0, 200)}`)
      }

      const data = JSON.parse(text) as BlockscoutV2Response

      if (data.items?.length) {
        const filtered = data.items.filter((log) => {
          const b = log.block_number
          return b >= fromBlock && b <= toBlock
        })
        allLogs.push(...filtered)
        if (Math.max(...data.items.map((l) => l.block_number)) < fromBlock) break
      } else {
        break
      }

      nextPageParams = data.next_page_params
      if (!nextPageParams) break
      pageCount++
      if (pageCount >= MAX_PAGES) {
        console.warn(
          `[Blockscout] Reached MAX_PAGES (${MAX_PAGES}). Results may be truncated for address ${address}. Consider reducing the block range.`
        )
      }
      await new Promise((r) => setTimeout(r, 100))
    } catch (err) {
      rateLimiter.recordFailure()
      if (retryCount < 3 && isNetworkError(err)) {
        await new Promise((r) => setTimeout(r, Math.min(2000 * Math.pow(2, retryCount), 10000)))
        return fetchLogsV2(baseUrl, address, fromBlock, toBlock, retryCount + 1)
      }
      throw err
    }
  }

  return allLogs
}
