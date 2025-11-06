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
 * Save a data point for a metric
 */
export function saveMetricHistory(metricKey: string, value: number | null): void {
  if (value === null) return
  
  try {
    const key = `${STORAGE_PREFIX}${metricKey}`
    const existing = getMetricHistory(metricKey)
    
    // Add new point
    const newPoint: HistoryPoint = {
      timestamp: Date.now(),
      value: parseFloat(value.toString()),
    }
    
    const updated = [...existing, newPoint]
    
    // Keep only last MAX_POINTS_PER_METRIC points
    const trimmed = updated.slice(-MAX_POINTS_PER_METRIC)
    
    localStorage.setItem(key, JSON.stringify(trimmed))
  } catch (error) {
    console.warn('Failed to save metric history:', error)
  }
}

/**
 * Get historical data for a metric
 */
export function getMetricHistory(metricKey: string): HistoryPoint[] {
  try {
    const key = `${STORAGE_PREFIX}${metricKey}`
    const stored = localStorage.getItem(key)
    if (!stored) return []
    
    return JSON.parse(stored) as HistoryPoint[]
  } catch (error) {
    console.warn('Failed to get metric history:', error)
    return []
  }
}

/**
 * Clear all historical data
 */
export function clearAllHistory(): void {
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

