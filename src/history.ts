/**
 * Historical data storage utilities using localStorage
 * Stores timestamped values for each metric
 */

export interface HistoryPoint {
  timestamp: number
  value: number
}

const STORAGE_PREFIX = 'rif_metrics_history_'
const MAX_POINTS_PER_METRIC = 100 // Keep last 100 data points

/**
 * Check if localStorage is available (client-side only)
 * Vercel builds run server-side, so we need to guard against SSR
 */
const isLocalStorageAvailable = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    const test = '__localStorage_test__'
    localStorage.setItem(test, test)
    localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

/**
 * Save a data point for a metric
 * Safe for Vercel builds - only runs client-side
 */
export function saveMetricHistory(metricKey: string, value: number | null): void {
  if (value === null || !isLocalStorageAvailable()) return
  
  try {
    const key = `${STORAGE_PREFIX}${metricKey}`
    const existing = getMetricHistory(metricKey)
    
    // Add new point
    const newPoint: HistoryPoint = {
      timestamp: Date.now(),
      value: Number(value), // More efficient than parseFloat(value.toString())
    }
    
    const updated = [...existing, newPoint]
    
    // Keep only last MAX_POINTS_PER_METRIC points
    const trimmed = updated.slice(-MAX_POINTS_PER_METRIC)
    
    localStorage.setItem(key, JSON.stringify(trimmed))
  } catch (error) {
    // Handle QuotaExceededError specifically
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.warn('localStorage quota exceeded, clearing old data')
      // Try to clear oldest entries and retry
      try {
        const key = `${STORAGE_PREFIX}${metricKey}`
        const existing = getMetricHistory(metricKey)
        // Keep only last 50 points if quota exceeded
        const trimmed = existing.slice(-50)
        localStorage.setItem(key, JSON.stringify(trimmed))
      } catch (retryError) {
        console.warn('Failed to save metric history after quota error:', retryError)
      }
    } else {
      console.warn('Failed to save metric history:', error)
    }
  }
}

/**
 * Get historical data for a metric
 * Safe for Vercel builds - returns empty array during SSR
 */
export function getMetricHistory(metricKey: string): HistoryPoint[] {
  if (!isLocalStorageAvailable()) return []
  
  try {
    const key = `${STORAGE_PREFIX}${metricKey}`
    const stored = localStorage.getItem(key)
    if (!stored) return []
    
    const parsed = JSON.parse(stored)
    
    // Validate data structure (type guard)
    if (!Array.isArray(parsed)) return []
    
    // Validate each point has required fields
    const validPoints = parsed.filter(
      (point): point is HistoryPoint =>
        typeof point === 'object' &&
        point !== null &&
        typeof point.timestamp === 'number' &&
        typeof point.value === 'number' &&
        !isNaN(point.timestamp) &&
        !isNaN(point.value)
    )
    
    return validPoints
  } catch (error) {
    console.warn('Failed to get metric history:', error)
    return []
  }
}

/**
 * Clear all historical data
 * Safe for Vercel builds - only runs client-side
 */
export function clearAllHistory(): void {
  if (!isLocalStorageAvailable()) return
  
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(STORAGE_PREFIX)) {
        localStorage.removeItem(key)
      }
    })
  } catch (error) {
    console.warn('Failed to clear history:', error)
  }
}

