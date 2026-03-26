/**
 * Transient failure detection and exponential backoff for fetches / RPC / explorer APIs.
 */

const TRANSIENT_HTTP = new Set([408, 425, 429, 502, 503, 504])

export function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP.has(status)
}

export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.name === 'AbortError' ||
    /timeout|Failed to fetch|network|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK_CHANGED|ERR_/i.test(
      err.message
    )
  )
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

export interface WithBackoffOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Return true to retry. Default: transient network or message hints at HTTP gateway errors. */
  shouldRetry?: (error: unknown, attemptIndex: number) => boolean
}

export function isOutdatedClientError(error: unknown): boolean {
  return error instanceof Error && error.message === 'OUTDATED_CLIENT'
}

const defaultShouldRetry = (error: unknown): boolean => {
  if (isOutdatedClientError(error)) return false
  if (isTransientNetworkError(error)) return true
  if (error instanceof Error) {
    return /(?:\b|^)(?:429|502|503|504|408)|blockscout_v2_transient|temporarily|timeout|unavailable|rate limit/i.test(
      error.message
    )
  }
  return false
}

/**
 * Retry an async operation with exponential backoff (bounded).
 */
export async function withBackoff<T>(operation: () => Promise<T>, options?: WithBackoffOptions): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4
  const baseDelayMs = options?.baseDelayMs ?? 450
  const maxDelayMs = options?.maxDelayMs ?? 10_000
  const shouldRetry = options?.shouldRetry ?? defaultShouldRetry

  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (e) {
      lastError = e
      if (!shouldRetry(e, attempt) || attempt === maxAttempts - 1) {
        throw e
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
      await sleep(delay)
    }
  }
  throw lastError
}
