import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { CONFIG } from './config'

// Mock ethers module
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')
  class MockJsonRpcProvider {
    constructor() {}
    getBlockNumber() {
      return Promise.resolve(1)
    }
  }

  const mockContract = {
    name: vi.fn().mockResolvedValue('USDRIF Token'),
    symbol: vi.fn().mockResolvedValue('USDRIF'),
    decimals: vi.fn().mockResolvedValue(18),
    totalSupply: vi.fn().mockResolvedValue(1000n * 10n ** 18n),
    read: vi.fn().mockResolvedValue(41n * 10n ** 16n), // 0.41
    getTotalACavailable: vi.fn().mockResolvedValue(212n * 10n ** 24n),
    calcCtargemaCA: vi.fn().mockResolvedValue(55n * 10n ** 17n), // 5.5
  }

  return {
    ...actual,
    ethers: {
      JsonRpcProvider: MockJsonRpcProvider,
      Contract: vi.fn().mockImplementation(() => mockContract),
      getAddress: vi.fn((address: string) => address),
      id: vi.fn(() => `0x${'0'.repeat(64)}`),
    },
  }
})

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderApp = () =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

  it('renders main metrics header', () => {
    renderApp()
    expect(screen.getByText(/rif metrics/i)).toBeInTheDocument()
  })

  it('displays refresh interval correctly', async () => {
    renderApp()

    await waitFor(() => {
      const refreshText = screen.getByText(
        new RegExp(`Auto-refreshes every ${Math.round(CONFIG.REFRESH_INTERVAL / 1000)} seconds`)
      )
      expect(refreshText).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('has refresh button', () => {
    renderApp()
    const refreshButton = screen.getByRole('button', { name: /refresh/i })
    expect(refreshButton).toBeInTheDocument()
  })
})

