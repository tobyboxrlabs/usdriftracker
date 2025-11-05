import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { CONFIG, ERC20_ABI, MOC_STATE_ABI } from './config'
import './App.css'

interface TokenData {
  totalSupply: string
  formattedSupply: string
  maxMintable: string | null
  formattedMaxMintable: string | null
  symbol: string
  name: string
  loading: boolean
  error: string | null
  lastUpdated: Date | null
}

function App() {
  const [tokenData, setTokenData] = useState<TokenData>({
    totalSupply: '0',
    formattedSupply: '0',
    maxMintable: null,
    formattedMaxMintable: null,
    symbol: 'USDRIF',
    name: 'USDRIF',
    loading: true,
    error: null,
    lastUpdated: null,
  })

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true)

  const formatAmount = (amount: bigint, decimals: number | bigint): string => {
    if (amount === 0n) {
      return '0'
    }
    
    const decimalsNum = Number(decimals)
    if (decimalsNum < 0 || decimalsNum > 255) {
      throw new Error(`Invalid decimals value: ${decimalsNum}`)
    }
    
    const factor = 10n ** BigInt(decimalsNum)
    const whole = amount / factor
    const frac = amount % factor
    
    if (frac === 0n) {
      return whole.toString()
    }
    
    const fracStr = frac.toString().padStart(decimalsNum, '0').replace(/0+$/, '')
    return fracStr ? `${whole}.${fracStr}` : whole.toString()
  }

  const fetchTokenData = useCallback(async () => {
    if (!isMountedRef.current) {
      return
    }

    try {
      setTokenData(prev => ({ ...prev, loading: true, error: null }))
      
      const provider = new ethers.JsonRpcProvider(CONFIG.ROOTSTOCK_RPC)
      // Normalize address to checksummed format (convert to lowercase first to handle bad checksums)
      let checksummedAddress: string
      try {
        // Try to get checksummed address - if it fails due to bad checksum, normalize to lowercase first
        checksummedAddress = ethers.getAddress(CONFIG.USDRIF_ADDRESS)
      } catch {
        // If checksum is invalid, convert to lowercase then checksum
        const normalizedAddress = CONFIG.USDRIF_ADDRESS.toLowerCase()
        checksummedAddress = ethers.getAddress(normalizedAddress)
      }
      const contract = new ethers.Contract(checksummedAddress, ERC20_ABI, provider)
      
      const [name, symbol, decimalsRaw, totalSupply] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply(),
      ])
      
      // Check if component is still mounted before updating state
      if (!isMountedRef.current) {
        return
      }
      
      // Convert decimals to number (it might be returned as BigInt)
      const decimals = Number(decimalsRaw)
      const formattedSupply = formatAmount(totalSupply, decimals)
      
      // Fetch max mintable from Money on Chain State contracts
      // Try multiple contracts in order of priority
      let maxMintable: bigint | null = null
      let formattedMaxMintable: string | null = null
      
      const functionNamesToTry = [
        'absoluteMaxDoc',
        'absoluteMaxStableToken',
        'getAbsoluteMaxDoc',
        'maxDoc',
        'maxStableToken'
      ]
      
      // Try each MoC State contract address
      for (const mocStateAddress of CONFIG.MOC_STATE_ADDRESSES) {
        if (!mocStateAddress) continue
        
        try {
          let mocChecksummedAddress: string
          try {
            mocChecksummedAddress = ethers.getAddress(mocStateAddress)
          } catch {
            const normalizedMocAddress = mocStateAddress.toLowerCase()
            mocChecksummedAddress = ethers.getAddress(normalizedMocAddress)
          }
          
          const mocState = new ethers.Contract(mocChecksummedAddress, MOC_STATE_ABI, provider)
          
          let absoluteMaxDoc: bigint | null = null
          
          // Try each function name until one works
          for (const fnName of functionNamesToTry) {
            try {
              absoluteMaxDoc = await mocState[fnName]()
              if (absoluteMaxDoc !== null && absoluteMaxDoc !== undefined) {
                console.log(`✓ Successfully called ${fnName} from MoC State at ${mocChecksummedAddress}`)
                break
              }
            } catch (fnError: any) {
              // Check if it's a deprecation error - if so, try next function or contract
              if (fnError?.message?.includes('deprecated') || fnError?.message?.includes('V2')) {
                console.log(`  Function ${fnName} is deprecated at ${mocChecksummedAddress}, trying next...`)
                continue
              }
              // For other errors, continue trying
              continue
            }
          }
          
          if (absoluteMaxDoc !== null && absoluteMaxDoc !== undefined) {
            // Calculate mintable amount: absoluteMaxDoc - totalSupply
            if (absoluteMaxDoc >= totalSupply) {
              maxMintable = absoluteMaxDoc - totalSupply
              formattedMaxMintable = formatAmount(maxMintable, decimals)
              console.log(`✓ Successfully calculated max mintable: ${formattedMaxMintable}`)
              break // Success, exit the contract loop
            } else {
              // If totalSupply exceeds absoluteMaxDoc, mintable is 0
              maxMintable = 0n
              formattedMaxMintable = '0'
              break
            }
          }
        } catch (mocError: any) {
          // Check if it's specifically a deprecation error
          if (mocError?.message?.includes('deprecated') || mocError?.message?.includes('V2')) {
            console.log(`  Contract ${mocStateAddress} is deprecated, trying next contract...`)
            continue // Try next contract
          } else {
            console.warn(`  Failed to query MoC State at ${mocStateAddress}:`, mocError?.message || mocError)
            continue // Try next contract
          }
        }
      }
      
      if (maxMintable === null) {
        console.warn('⚠ Could not fetch max mintable from any MoC State contract')
      }
      
      // Final check before state update
      if (!isMountedRef.current) {
        return
      }
      
      setTokenData({
        totalSupply: totalSupply.toString(),
        formattedSupply,
        maxMintable: maxMintable ? maxMintable.toString() : null,
        formattedMaxMintable,
        symbol,
        name,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      })
    } catch (error) {
      console.error('Error fetching token data:', error)
      
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setTokenData(prev => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch token data',
        }))
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    
    // Fetch immediately on mount
    fetchTokenData()
    
    // Set up interval to refresh based on CONFIG.REFRESH_INTERVAL
    const interval = setInterval(() => {
      fetchTokenData()
    }, CONFIG.REFRESH_INTERVAL)
    
    return () => {
      isMountedRef.current = false
      clearInterval(interval)
    }
  }, [fetchTokenData])

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>USDRIF Tracker</h1>
          <p className="subtitle">Real-time token metrics on Rootstock</p>
        </header>

        <div className="card">
          <div className="card-header">
            <h2>{tokenData.name}</h2>
            {tokenData.lastUpdated && (
              <span className="last-updated">
                Last updated: {tokenData.lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>

          {tokenData.loading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>Loading token data...</p>
            </div>
          ) : tokenData.error ? (
            <div className="error">
              <p>⚠️ Error: {tokenData.error}</p>
              <button onClick={fetchTokenData} className="retry-button">
                Retry
              </button>
            </div>
          ) : (
            <div className="metrics">
              <div className="metric">
                <div className="metric-label">Total Supply</div>
                <div className="metric-value">
                  {(() => {
                    const value = parseFloat(tokenData.formattedSupply)
                    return isNaN(value) 
                      ? tokenData.formattedSupply 
                      : value.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })
                  })()}
                </div>
                <div className="metric-unit">{tokenData.symbol}</div>
              </div>
              {tokenData.formattedMaxMintable !== null ? (
                <div className="metric">
                  <div className="metric-label">USDRIF Mintable</div>
                  <div className="metric-value">
                    {(() => {
                      const value = parseFloat(tokenData.formattedMaxMintable!)
                      return isNaN(value)
                        ? tokenData.formattedMaxMintable!
                        : value.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })
                    })()}
                  </div>
                  <div className="metric-unit">{tokenData.symbol}</div>
                </div>
              ) : (
                <div className="metric metric-disabled">
                  <div className="metric-label">USDRIF Mintable</div>
                  <div className="metric-value">—</div>
                  <div className="metric-unit">Not Available</div>
                </div>
              )}
            </div>
          )}

          <div className="card-footer">
            <button onClick={fetchTokenData} className="refresh-button" disabled={tokenData.loading}>
              {tokenData.loading ? 'Refreshing...' : 'Refresh Now'}
            </button>
            <p className="info">
              Auto-refreshes every {Math.round(CONFIG.REFRESH_INTERVAL / 1000)} seconds
            </p>
          </div>
        </div>

        <footer className="footer">
          <p>
            Token Address: <code>{CONFIG.USDRIF_ADDRESS}</code>
          </p>
        </footer>
      </div>
    </div>
  )
}

export default App
