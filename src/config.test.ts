import { describe, it, expect } from 'vitest'
import { CONFIG, ERC20_ABI, ROC_STATE_ABI } from './config'

describe('Config', () => {
  it('has valid RPC endpoint', () => {
    expect(CONFIG.ROOTSTOCK_RPC).toBeTruthy()
    expect(typeof CONFIG.ROOTSTOCK_RPC).toBe('string')
  })

  it('has valid USDRIF address', () => {
    expect(CONFIG.USDRIF_ADDRESS).toBeTruthy()
    expect(CONFIG.USDRIF_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('has valid refresh interval', () => {
    expect(CONFIG.REFRESH_INTERVAL).toBeGreaterThan(0)
    expect(typeof CONFIG.REFRESH_INTERVAL).toBe('number')
  })

  it('has valid ERC20 ABI', () => {
    expect(ERC20_ABI).toBeDefined()
    expect(Array.isArray(ERC20_ABI)).toBe(true)
    expect(ERC20_ABI.length).toBeGreaterThan(0)
  })

  it('has valid ROC_STATE_ABI if ROC_STATE_ADDRESS is set', () => {
    expect(ROC_STATE_ABI).toBeDefined()
    expect(Array.isArray(ROC_STATE_ABI)).toBe(true)
  })

  it('has valid max mintable function name', () => {
    expect(CONFIG.MAX_MINTABLE_FN).toBeTruthy()
    expect(typeof CONFIG.MAX_MINTABLE_FN).toBe('string')
  })
})

