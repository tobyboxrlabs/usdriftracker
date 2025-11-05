import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { CONFIG } from './config'

// Mock ethers module
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')
  return {
    ...actual,
    ethers: {
      JsonRpcProvider: vi.fn().mockImplementation(() => ({})),
      Contract: vi.fn().mockImplementation(() => ({
        name: vi.fn().mockResolvedValue('USDRIF Token'),
        symbol: vi.fn().mockResolvedValue('USDRIF'),
        decimals: vi.fn().mockResolvedValue(18),
        totalSupply: vi.fn().mockResolvedValue('1000000000000000000000'), // 1000 tokens
      })),
      getAddress: vi.fn((address: string) => address),
    },
  }
})

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    render(<App />)
    expect(screen.getByText(/loading token data/i)).toBeInTheDocument()
  })

  it('displays refresh interval correctly', async () => {
    render(<App />)

    await waitFor(() => {
      const refreshText = screen.getByText(
        new RegExp(`Auto-refreshes every ${Math.round(CONFIG.REFRESH_INTERVAL / 1000)} seconds`)
      )
      expect(refreshText).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('has refresh button', () => {
    render(<App />)
    const refreshButton = screen.getByRole('button', { name: /refresh/i })
    expect(refreshButton).toBeInTheDocument()
  })
})

