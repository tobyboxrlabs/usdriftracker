import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MiniLineGraph } from '../MiniLineGraph'
import type { HistoryPoint } from '../history'

/**
 * Format a numeric string with locale-aware formatting.
 * Handles NaN gracefully by returning the original string.
 */
export function formatNumericValue(
  value: string,
  options: { maximumFractionDigits: number; prefix?: string } = { maximumFractionDigits: 0 }
): string {
  const numValue = parseFloat(value)
  if (isNaN(numValue)) return value
  const formatted = numValue.toLocaleString(undefined, {
    maximumFractionDigits: options.maximumFractionDigits,
  })
  return options.prefix ? `${options.prefix}${formatted}` : formatted
}

interface TooltipProps {
  text: string
  triggerRef: React.RefObject<HTMLElement>
  isVisible: boolean
}

function Tooltip({ text, triggerRef, isVisible }: TooltipProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const tooltipWidth = 280
      const tooltipHeight = 120
      setPosition({
        top: rect.top - tooltipHeight - 10,
        left: rect.left + rect.width / 2 - tooltipWidth / 2,
      })
    }
  }, [triggerRef])

  useEffect(() => {
    if (isVisible) {
      updatePosition()
      const handleScroll = () => updatePosition()
      const handleResize = () => updatePosition()
      window.addEventListener('scroll', handleScroll, true)
      window.addEventListener('resize', handleResize)
      return () => {
        window.removeEventListener('scroll', handleScroll, true)
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [isVisible, updatePosition])

  if (!isVisible) return null

  return createPortal(
    <div
      className="metric-help-tooltip-portal"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 100000,
      }}
    >
      {text}
      <div className="metric-help-tooltip-arrow"></div>
    </div>,
    document.body
  )
}

export interface MetricDisplayProps {
  label: string
  value: string | null
  unit: string
  formatOptions?: { maximumFractionDigits: number; prefix?: string }
  isRefreshing?: boolean
  history?: HistoryPoint[]
  helpText?: string
}

export function MetricDisplay({
  label,
  value,
  unit,
  formatOptions,
  isRefreshing = false,
  history,
  helpText,
}: MetricDisplayProps) {
  const helpIconRef = useRef<HTMLSpanElement>(null)
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)

  const toggleTooltip = useCallback(() => setIsTooltipVisible((prev) => !prev), [])
  const closeTooltip = useCallback(() => setIsTooltipVisible(false), [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggleTooltip()
      } else if (e.key === 'Escape') {
        closeTooltip()
      }
    },
    [toggleTooltip, closeTooltip]
  )

  useEffect(() => {
    if (isTooltipVisible) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeTooltip()
      }
      window.addEventListener('keydown', handleEscape)
      return () => window.removeEventListener('keydown', handleEscape)
    }
  }, [isTooltipVisible, closeTooltip])

  const helpIcon = helpText && (
    <>
      <span
        ref={helpIconRef}
        className="metric-help"
        role="button"
        tabIndex={0}
        aria-expanded={isTooltipVisible}
        aria-label="More information about this metric"
        onMouseEnter={() => setIsTooltipVisible(true)}
        onMouseLeave={() => setIsTooltipVisible(false)}
        onClick={toggleTooltip}
        onKeyDown={handleKeyDown}
      >
        <span className="metric-help-icon">?</span>
      </span>
      <Tooltip text={helpText} triggerRef={helpIconRef} isVisible={isTooltipVisible} />
    </>
  )

  if (value === null) {
    return (
      <div className="metric metric-disabled">
        <div className="metric-label">{label}</div>
        {isRefreshing && <span className="metric-refresh-indicator"></span>}
        <div className="metric-value">—</div>
        <div className="metric-unit">
          Not Available
          {helpIcon}
        </div>
      </div>
    )
  }

  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      {isRefreshing && <span className="metric-refresh-indicator"></span>}
      <div className="metric-content">
        <div className="metric-value-wrapper">
          <div className="metric-value">{formatNumericValue(value, formatOptions)}</div>
          <div className="metric-unit">
            {unit}
            {helpIcon}
          </div>
        </div>
        {history && history.length >= 2 ? (
          <div className="metric-graph">
            <MiniLineGraph data={history} />
          </div>
        ) : history && history.length === 1 ? (
          <div className="metric-graph metric-graph-placeholder">
            <span>Collecting data...</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
