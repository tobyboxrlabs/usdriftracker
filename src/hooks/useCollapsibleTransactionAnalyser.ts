import { useState, useEffect, useCallback, useRef } from 'react'
import { userFacingError } from '../utils/userFacingError'

/** Progress shape expected by {@link AnalyserShell} and mint/vault fetch pipelines. */
export type AnalyserLoadingProgress = { current: number; total: number; phase: string }

export interface UseCollapsibleTransactionAnalyserOptions<TTx> {
  initialExpanded?: boolean
  initialDays?: number
  /** Used when `initialDays` is undefined (e.g. collapsed on load). */
  defaultDays?: number
  fetchRecentTxs: (
    days: number,
    onProgress?: (p: AnalyserLoadingProgress | null) => void
  ) => Promise<{ recentTxs: TTx[] }>
  onFetchError: (err: unknown) => void
}

/**
 * Shared expand/collapse + days + loading + progress timeout pattern for Mint/Redeem and vUSD vault analysers.
 */
export function useCollapsibleTransactionAnalyser<TTx>({
  initialExpanded,
  initialDays,
  defaultDays = 1,
  fetchRecentTxs,
  onFetchError,
}: UseCollapsibleTransactionAnalyserOptions<TTx>) {
  const [transactions, setTransactions] = useState<TTx[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(initialDays ?? defaultDays)
  const [loadingProgress, setLoadingProgress] = useState<AnalyserLoadingProgress | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(!(initialExpanded ?? false))
  const progressTimeoutRef = useRef<number | null>(null)
  /** Inline `onFetchError` from parents would otherwise change every render and retrigger fetch in an infinite loop. */
  const onFetchErrorRef = useRef(onFetchError)
  onFetchErrorRef.current = onFetchError

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadingProgress(null)

    try {
      const { recentTxs } = await fetchRecentTxs(days, setLoadingProgress)
      setTransactions(recentTxs)
      setLastUpdated(new Date())
    } catch (err) {
      setError(userFacingError(err))
      onFetchErrorRef.current(err)
    } finally {
      setLoading(false)
      if (progressTimeoutRef.current) clearTimeout(progressTimeoutRef.current)
      progressTimeoutRef.current = window.setTimeout(() => setLoadingProgress(null), 500)
    }
  }, [days, fetchRecentTxs])

  useEffect(() => {
    if (!isCollapsed) {
      fetchTransactions()
    }
  }, [fetchTransactions, isCollapsed])

  useEffect(() => {
    return () => {
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current)
        progressTimeoutRef.current = null
      }
    }
  }, [])

  return {
    transactions,
    setTransactions,
    loading,
    error,
    days,
    setDays,
    loadingProgress,
    lastUpdated,
    isCollapsed,
    setIsCollapsed,
    fetchTransactions,
  }
}
