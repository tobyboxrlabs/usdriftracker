import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MiniLineGraph } from '../MiniLineGraph'
import type { HistoryPoint } from '../history'
import { clampTooltipPosition, getTooltipMaxWidth } from '../utils/tooltipPosition'

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
  wide?: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

function Tooltip({
  text,
  triggerRef,
  isVisible,
  wide = false,
  onPointerEnter,
  onPointerLeave,
}: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [copied, setCopied] = useState(false)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const anchor = triggerRef.current.getBoundingClientRect()
    const el = tooltipRef.current
    const size = {
      width: el?.offsetWidth ?? getTooltipMaxWidth(wide),
      height: el?.offsetHeight ?? (wide ? 200 : 120),
    }
    setPosition(clampTooltipPosition(anchor, size, wide))
  }, [triggerRef, wide])

  useLayoutEffect(() => {
    if (!isVisible) return
    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(raf)
  }, [isVisible, updatePosition, text, wide])

  useEffect(() => {
    if (!isVisible) return
    const handleScroll = () => updatePosition()
    const handleResize = () => updatePosition()
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [isVisible, updatePosition])

  useEffect(() => {
    if (!isVisible) setCopied(false)
  }, [isVisible])

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      } catch {
        setCopied(false)
      }
    },
    [text]
  )

  if (!isVisible) return null

  return createPortal(
    <div
      ref={tooltipRef}
      className={`metric-help-tooltip-portal${wide ? ' metric-help-tooltip-portal--wide' : ''}`}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: wide ? `${getTooltipMaxWidth(wide)}px` : undefined,
        maxWidth: wide ? undefined : `${getTooltipMaxWidth(false)}px`,
        zIndex: 100000,
      }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="metric-help-tooltip-copy"
        aria-label={copied ? 'Copied to clipboard' : 'Copy help text to clipboard'}
        title={copied ? 'Copied' : 'Copy'}
        onClick={handleCopy}
      >
        {copied ? '✓' : '⎘'}
      </button>
      <div className="metric-help-tooltip-body">{text}</div>
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
  /** Optional second line (smaller type), e.g. on-chain cross-check. */
  secondaryValue?: string | null
  secondaryFormatOptions?: { maximumFractionDigits: number; prefix?: string }
  secondaryLabel?: string
  isRefreshing?: boolean
  history?: HistoryPoint[]
  helpText?: string
  /** Wider tooltip with pre-line breaks (for multi-section help copy). */
  helpTooltipWide?: boolean
}

export function MetricDisplay({
  label,
  value,
  unit,
  formatOptions,
  secondaryValue = null,
  secondaryFormatOptions = { maximumFractionDigits: 0 },
  secondaryLabel = 'On-chain',
  isRefreshing = false,
  history,
  helpText,
  helpTooltipWide = false,
}: MetricDisplayProps) {
  const helpIconRef = useRef<HTMLSpanElement>(null)
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const hideTooltipTimeoutRef = useRef<number | null>(null)

  const showTooltip = useCallback(() => {
    if (hideTooltipTimeoutRef.current != null) {
      window.clearTimeout(hideTooltipTimeoutRef.current)
      hideTooltipTimeoutRef.current = null
    }
    setIsTooltipVisible(true)
  }, [])

  const scheduleHideTooltip = useCallback(() => {
    if (hideTooltipTimeoutRef.current != null) {
      window.clearTimeout(hideTooltipTimeoutRef.current)
    }
    hideTooltipTimeoutRef.current = window.setTimeout(() => {
      setIsTooltipVisible(false)
      hideTooltipTimeoutRef.current = null
    }, 200)
  }, [])

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

  useEffect(() => {
    return () => {
      if (hideTooltipTimeoutRef.current != null) {
        window.clearTimeout(hideTooltipTimeoutRef.current)
      }
    }
  }, [])

  const helpIcon = helpText && (
    <>
      <span
        ref={helpIconRef}
        className="metric-help"
        role="button"
        tabIndex={0}
        aria-expanded={isTooltipVisible}
        aria-label="More information about this metric"
        onMouseEnter={showTooltip}
        onMouseLeave={scheduleHideTooltip}
        onClick={toggleTooltip}
        onKeyDown={handleKeyDown}
      >
        <span className="metric-help-icon">?</span>
      </span>
      <Tooltip
        text={helpText}
        triggerRef={helpIconRef}
        isVisible={isTooltipVisible}
        wide={helpTooltipWide}
        onPointerEnter={showTooltip}
        onPointerLeave={scheduleHideTooltip}
      />
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
          {secondaryValue != null && (
            <div className="metric-value-secondary">
              <span className="metric-value-secondary-label">{secondaryLabel}</span>{' '}
              {formatNumericValue(secondaryValue, secondaryFormatOptions)}
            </div>
          )}
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
