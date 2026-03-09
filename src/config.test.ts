import { describe, it, expect } from 'vitest'
import { CONFIG, ERC20_ABI, MOC_STATE_ABI } from './config'

describe('Config', () => {
  it('has valid RPC endpoint', () => {
    expect(CONFIG.ROOTSTOCK_RPC).toBeTruthy()
    expect(typeof CONFIG.ROOTSTOCK_RPC).toBe('string')
  })

  it('has valid stRIF address', () => {
    expect(CONFIG.STRIF_ADDRESS).toBeTruthy()
    expect(CONFIG.STRIF_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/)
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

  it('has valid MOC_STATE_ABI', () => {
    expect(MOC_STATE_ABI).toBeDefined()
    expect(Array.isArray(MOC_STATE_ABI)).toBe(true)
    expect(MOC_STATE_ABI.length).toBeGreaterThan(0)
  })

  it('has valid RPC alternatives', () => {
    expect(CONFIG.ROOTSTOCK_RPC_ALTERNATIVES).toBeDefined()
    expect(Array.isArray(CONFIG.ROOTSTOCK_RPC_ALTERNATIVES)).toBe(true)
    expect(CONFIG.ROOTSTOCK_RPC_ALTERNATIVES.length).toBeGreaterThan(0)
  })

  it('has a client version string', () => {
    expect(CONFIG.CLIENT_VERSION).toBeTruthy()
    expect(typeof CONFIG.CLIENT_VERSION).toBe('string')
  })
})

