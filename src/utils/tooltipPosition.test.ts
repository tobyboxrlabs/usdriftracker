import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clampTooltipPosition, getTooltipMaxWidth } from './tooltipPosition'

describe('tooltipPosition', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('caps wide max width to viewport minus margins', () => {
    expect(getTooltipMaxWidth(true)).toBe(358)
    expect(getTooltipMaxWidth(false)).toBe(280)
  })

  it('clamps horizontal position so tooltip stays in viewport', () => {
    const anchor = {
      left: 10,
      top: 400,
      width: 24,
      height: 24,
      right: 34,
      bottom: 424,
    } as DOMRect
    const { left } = clampTooltipPosition(anchor, { width: 358, height: 180 }, true)
    expect(left).toBeGreaterThanOrEqual(16)
    expect(left + 358).toBeLessThanOrEqual(390 - 16)
  })
})
