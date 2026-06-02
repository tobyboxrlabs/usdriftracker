const VIEWPORT_MARGIN = 16
const GAP_ABOVE_ANCHOR = 10

export function getTooltipMaxWidth(wide: boolean): number {
  const preferred = wide ? 400 : 280
  return Math.min(preferred, window.innerWidth - VIEWPORT_MARGIN * 2)
}

export function clampTooltipPosition(
  anchor: DOMRect,
  size: { width: number; height: number },
  wide: boolean
): { top: number; left: number } {
  const width = size.width > 0 ? size.width : getTooltipMaxWidth(wide)
  const height = size.height > 0 ? size.height : wide ? 200 : 120

  let left = anchor.left + anchor.width / 2 - width / 2
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN)
  )

  let top = anchor.top - height - GAP_ABOVE_ANCHOR
  if (top < VIEWPORT_MARGIN) {
    top = Math.min(
      anchor.bottom + GAP_ABOVE_ANCHOR,
      window.innerHeight - height - VIEWPORT_MARGIN
    )
  }

  return { top, left }
}
