/**
 * Mini line graph component for displaying metric trends
 * Uses SVG to draw a simple line chart
 */
import { HistoryPoint } from './history'

interface MiniLineGraphProps {
  data: HistoryPoint[]
  width?: number
  height?: number
  color?: string
}

let gradientIdCounter = 0

export const MiniLineGraph = ({ 
  data, 
  width = 80, 
  height = 40,
  color = '#00ffff'
}: MiniLineGraphProps) => {
  if (data.length < 2) {
    return null // Need at least 2 points to draw a line
  }

  // Generate unique gradient ID
  const gradientId = `gradient-${++gradientIdCounter}`

  // Normalize data to fit within graph bounds
  const padding = 4
  const graphWidth = width - padding * 2
  const graphHeight = height - padding * 2

  const values = data.map(d => d.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const valueRange = maxValue - minValue || 1 // Avoid division by zero

  // Generate SVG path
  const points = data.map((point, index) => {
    const x = padding + (index / (data.length - 1)) * graphWidth
    const y = padding + height - ((point.value - minValue) / valueRange) * graphHeight - padding * 2
    return `${x},${y}`
  })

  const pathData = `M ${points.join(' L ')}`

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', margin: '0 auto' }}
      className="mini-line-graph"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <path
        d={`${pathData} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`}
        fill={`url(#${gradientId})`}
      />
      {/* Line */}
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

