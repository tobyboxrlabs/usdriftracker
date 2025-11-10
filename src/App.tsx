import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Routes, Route, Link } from 'react-router-dom'
import { ethers } from 'ethers'
import { CONFIG, ERC20_ABI, PRICE_FEED_ABI, MOC_CORE_ABI } from './config'
import { saveMetricHistory, getMetricHistory, HistoryPoint } from './history'
import { MiniLineGraph } from './MiniLineGraph'
import LightCycleGame from './LightCycleGame'
import './App.css'

/**
 * Token metric data structure
 * Only includes fields that are actively used and displayed
 */
interface TokenData {
  // Token supplies
  stRIFSupply: string
  formattedStRIFSupply: string
  rifproSupply: string
  formattedRifproSupply: string
  minted: string | null
  formattedMinted: string | null
  
  // Price and collateral
  rifPrice: string | null
  formattedRifPrice: string | null
  rifCollateral: string | null
  formattedRifCollateral: string | null
  
  // Minting capacity
  maxMintable: string | null
  formattedMaxMintable: string | null
  
  // Token metadata
  symbol: string
  name: string
  
  // UI state
  loading: boolean
  error: string | null
  lastUpdated: Date | null
}

/**
 * Initial state for token data
 */
const INITIAL_TOKEN_DATA: TokenData = {
  stRIFSupply: '0',
  formattedStRIFSupply: '0',
  rifproSupply: '0',
  formattedRifproSupply: '0',
  minted: null,
  formattedMinted: null,
  rifPrice: null,
  formattedRifPrice: null,
  rifCollateral: null,
  formattedRifCollateral: null,
  maxMintable: null,
  formattedMaxMintable: null,
  symbol: 'USDRIF',
  name: 'USDRIF',
  loading: true,
  error: null,
  lastUpdated: null,
}

/**
 * Format a numeric string with locale-aware formatting
 * Handles NaN gracefully by returning the original string
 */
const formatNumericValue = (
  value: string,
  options: { maximumFractionDigits: number; prefix?: string } = { maximumFractionDigits: 0 }
): string => {
  const numValue = parseFloat(value)
  if (isNaN(numValue)) {
    return value
  }
  const formatted = numValue.toLocaleString(undefined, {
    maximumFractionDigits: options.maximumFractionDigits,
  })
  return options.prefix ? `${options.prefix}${formatted}` : formatted
}

/**
 * Tooltip component that renders via portal to escape parent stacking contexts
 */
interface TooltipProps {
  text: string
  triggerRef: React.RefObject<HTMLElement>
  isVisible: boolean
}

const Tooltip = ({ text, triggerRef, isVisible }: TooltipProps) => {
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const tooltipWidth = 280
      const tooltipHeight = 120 // approximate
      
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

/**
 * Metric display component
 * Renders a single metric with label, value, and unit
 * Shows "Not Available" state when value is null
 */
interface MetricDisplayProps {
  label: string
  value: string | null
  unit: string
  formatOptions?: { maximumFractionDigits: number; prefix?: string }
  isRefreshing?: boolean
  history?: HistoryPoint[]
  helpText?: string
}

const MetricDisplay = ({ label, value, unit, formatOptions, isRefreshing = false, history, helpText }: MetricDisplayProps) => {
  const helpIconRef = useRef<HTMLSpanElement>(null)
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)

  if (value === null) {
    return (
      <div className="metric metric-disabled">
        <div className="metric-label">{label}</div>
        {isRefreshing && <span className="metric-refresh-indicator"></span>}
        <div className="metric-value">—</div>
        <div className="metric-unit">
          Not Available
          {helpText && (
            <>
              <span
                ref={helpIconRef}
                className="metric-help"
                onMouseEnter={() => setIsTooltipVisible(true)}
                onMouseLeave={() => setIsTooltipVisible(false)}
              >
                <span className="metric-help-icon">?</span>
              </span>
              <Tooltip text={helpText} triggerRef={helpIconRef} isVisible={isTooltipVisible} />
            </>
          )}
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
          <div className="metric-value">
            {formatNumericValue(value, formatOptions)}
          </div>
          <div className="metric-unit">
            {unit}
            {helpText && (
              <>
                <span
                  ref={helpIconRef}
                  className="metric-help"
                  onMouseEnter={() => setIsTooltipVisible(true)}
                  onMouseLeave={() => setIsTooltipVisible(false)}
                >
                  <span className="metric-help-icon">?</span>
                </span>
                <Tooltip text={helpText} triggerRef={helpIconRef} isVisible={isTooltipVisible} />
              </>
            )}
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

function App() {
  const [tokenData, setTokenData] = useState<TokenData>(INITIAL_TOKEN_DATA)
  const [refreshingMetrics, setRefreshingMetrics] = useState<Set<string>>(new Set())
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [deploymentCount, setDeploymentCount] = useState<number | null>(null)

  // Track component mount state to prevent state updates after unmount
  const isMountedRef = useRef(true)

  /**
   * Normalize Ethereum address to checksummed format
   * Handles invalid checksums by converting to lowercase first
   */
  const getChecksummedAddress = useCallback((address: string): string => {
    try {
      return ethers.getAddress(address)
    } catch {
      return ethers.getAddress(address.toLowerCase())
    }
  }, [])

  /**
   * Format BigInt amount with specified decimals
   * Returns human-readable string representation
   */
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

  /**
   * Get a working RPC provider by trying multiple endpoints
   * Falls back to alternative endpoints if the primary fails due to CORS
   */
  const getWorkingProvider = async (): Promise<ethers.JsonRpcProvider | null> => {
    const endpoints = CONFIG.ROOTSTOCK_RPC_ALTERNATIVES || [CONFIG.ROOTSTOCK_RPC]
    
    for (const endpoint of endpoints) {
      try {
        const provider = new ethers.JsonRpcProvider(endpoint)
        // Test connection by attempting to get block number
        await provider.getBlockNumber()
        return provider
      } catch (error) {
        console.warn(`RPC endpoint ${endpoint} failed, trying next...`, error)
        continue
      }
    }
    
    return null
  }

  /**
   * Query optional metric from contract
   * Returns null if query fails, allowing app to continue without the metric
   */
  const queryOptionalMetric = async (
    provider: ethers.Provider,
    address: string,
    abi: readonly string[],
    queryFn: (contract: ethers.Contract) => Promise<bigint>,
    decimals: number = 18
  ): Promise<{ raw: bigint; formatted: string } | null> => {
    try {
      const checksummedAddress = getChecksummedAddress(address)
      const contract = new ethers.Contract(checksummedAddress, abi, provider)
      const raw = await queryFn(contract)
      const formatted = formatAmount(raw, decimals)
      return { raw, formatted }
    } catch (error) {
      console.warn(`Failed to query metric from ${address}:`, error)
      return null
    }
  }

  const fetchTokenData = useCallback(async () => {
    if (!isMountedRef.current) {
      return
    }

    try {
      // Mark all metrics as refreshing
      setRefreshingMetrics(new Set([
        'stRIFSupply',
        'rifproSupply',
        'minted',
        'rifPrice',
        'rifCollateral',
        'maxMintable',
      ]))
      
      setTokenData(prev => ({ ...prev, loading: true, error: null }))

      // Get a working provider (tries multiple endpoints for CORS issues)
      const provider = await getWorkingProvider()
      if (!provider) {
        throw new Error('Unable to connect to any RSK RPC endpoint. Please check your network connection or configure VITE_ROOTSTOCK_RPC environment variable.')
      }

      // Setup contract instances
      const stRIFContract = new ethers.Contract(
        getChecksummedAddress(CONFIG.STRIF_ADDRESS),
        ERC20_ABI,
        provider
      )
      const rifproContract = new ethers.Contract(
        getChecksummedAddress(CONFIG.RIFPRO_ADDRESS),
        ERC20_ABI,
        provider
      )
      const oldUSDRIFContract = new ethers.Contract(
        getChecksummedAddress(CONFIG.USDRIF_ADDRESS),
        ERC20_ABI,
        provider
      )

      // Fetch all token data in parallel
      const [
        stRIFSupply,
        stRIFDecimalsRaw,
        rifproSupply,
        rifproDecimalsRaw,
        USDRIFSupply,
        USDRIFDecimalsRaw,
        name,
        symbol,
      ] = await Promise.all([
        stRIFContract.totalSupply(),
        stRIFContract.decimals(),
        rifproContract.totalSupply(),
        rifproContract.decimals(),
        oldUSDRIFContract.totalSupply(),
        oldUSDRIFContract.decimals(),
        stRIFContract.name(),
        stRIFContract.symbol(),
      ])

      // Check mount state before continuing
      if (!isMountedRef.current) {
        return
      }

      // Convert decimals to numbers
      const stRIFDecimals = Number(stRIFDecimalsRaw)
      const rifproDecimals = Number(rifproDecimalsRaw)
      const USDRIFDecimals = Number(USDRIFDecimalsRaw)

      // Format token supplies
      const formattedStRIFSupply = formatAmount(stRIFSupply, stRIFDecimals)
      const formattedRifproSupply = formatAmount(rifproSupply, rifproDecimals)
      const formattedMinted = formatAmount(USDRIFSupply, USDRIFDecimals)

      // Query optional metrics (these may fail without breaking the app)
      const rifPriceResult = await queryOptionalMetric(
        provider,
        CONFIG.RIF_PRICE_FEED_RLABS,
        PRICE_FEED_ABI,
        async (contract) => await contract.read(),
        18
      )

      // Query MoC price feed for mintable calculation (may differ from RLabs)
      const rifPriceMocResult = await queryOptionalMetric(
        provider,
        CONFIG.RIF_PRICE_FEED_MOC,
        PRICE_FEED_ABI,
        async (contract) => await contract.read(),
        18
      )

      const rifCollateralResult = await queryOptionalMetric(
        provider,
        CONFIG.MOC_V2_CORE,
        MOC_CORE_ABI,
        async (contract) => await contract.getTotalACavailable(),
        18
      )

      // Calculate USDRIF Mintable using the formula:
      // 1. Get total RIF collateral (~212m)
      // 2. Divide by coverage ratio (~5.5) to get Ratio'd RIF amount (~38m)
      // 3. Multiply by RIF/USD price (~0.0413) to get USD equiv Ratio'd RIF (~1.5m)
      // 4. Find difference between USD Equiv Ratio'd RIF and already minted USDRIF (~1.5m) => mintable USDRIF (~99k)
      let maxMintable: bigint | null = null
      let formattedMaxMintable: string | null = null

      if (rifCollateralResult && rifPriceMocResult && formattedMinted) {
        try {
          // Query target coverage ratio from MoC V2 Core (calcCtargemaCA returns ~5.5)
          const targetCoverageResult = await queryOptionalMetric(
            provider,
            CONFIG.MOC_V2_CORE,
            MOC_CORE_ABI,
            async (contract) => await contract.calcCtargemaCA(),
            18
          )

          if (targetCoverageResult) {
            // Step 1: Total RIF Collateral (already have from rifCollateralResult)
            const totalRifCollateral = parseFloat(rifCollateralResult.formatted) // ~212,057,756
            
            // Step 2: Coverage Ratio (target coverage EMA)
            const coverageRatio = parseFloat(targetCoverageResult.formatted) // ~5.5
            
            // Step 3: Ratio'd RIF = Total RIF Collateral / Coverage Ratio
            const ratioDRif = totalRifCollateral / coverageRatio // ~38,556,864
            
            // Step 4: RIF/USD Price (use MoC price feed for mintable calculation)
            const rifPrice = parseFloat(rifPriceMocResult.formatted) // May differ from RLabs price
            
            // Step 5: USD Equiv Ratio'd RIF = Ratio'd RIF × RIF Price
            const usdEquivRatioDRif = ratioDRif * rifPrice // ~1,592,398
            
            // Step 6: Already Minted USDRIF
            const mintedUsdrif = parseFloat(formattedMinted) // ~1,510,574
            
            // Step 7: Mintable USDRIF = USD Equiv Ratio'd RIF - Already Minted
            const mintableUsdrif = usdEquivRatioDRif - mintedUsdrif
            
            // Only set if mintable is positive
            if (mintableUsdrif > 0) {
              // Convert back to BigInt with 18 decimals (USDRIF uses 18 decimals)
              const mintableBigInt = BigInt(Math.floor(mintableUsdrif * 1e18))
              maxMintable = mintableBigInt
              formattedMaxMintable = Math.floor(mintableUsdrif).toString()
            } else {
              maxMintable = 0n
              formattedMaxMintable = '0'
            }
          }
        } catch (error) {
          console.warn('Failed to calculate USDRIF Mintable:', error)
        }
      }

      // Final mount check before state update
      if (!isMountedRef.current) {
        return
      }

      // Save history and update state
      const metricKeys = {
        stRIFSupply: parseFloat(formattedStRIFSupply),
        rifproSupply: parseFloat(formattedRifproSupply),
        minted: parseFloat(formattedMinted),
        rifPrice: rifPriceResult?.formatted ? parseFloat(rifPriceResult.formatted) : null,
        rifCollateral: rifCollateralResult?.formatted ? parseFloat(rifCollateralResult.formatted) : null,
        maxMintable: formattedMaxMintable ? parseFloat(formattedMaxMintable) : null,
      }

      // Save each metric to history
      Object.entries(metricKeys).forEach(([key, value]) => {
        if (value !== null && !isNaN(value)) {
          saveMetricHistory(key, value)
        }
      })
      
      // Debug: Log history counts
      const historyCounts = Object.fromEntries(
        Object.keys(metricKeys).map(key => [key, getMetricHistory(key).length])
      )
      console.log('History data points:', historyCounts)

      // Update state with all fetched data, preserving existing values if new ones aren't available
      setTokenData(prev => ({
        stRIFSupply: stRIFSupply ? stRIFSupply.toString() : prev.stRIFSupply,
        formattedStRIFSupply: formattedStRIFSupply || prev.formattedStRIFSupply,
        rifproSupply: rifproSupply ? rifproSupply.toString() : prev.rifproSupply,
        formattedRifproSupply: formattedRifproSupply || prev.formattedRifproSupply,
        minted: USDRIFSupply ? USDRIFSupply.toString() : prev.minted,
        formattedMinted: formattedMinted || prev.formattedMinted,
        rifPrice: rifPriceResult?.raw ? rifPriceResult.raw.toString() : prev.rifPrice,
        formattedRifPrice: rifPriceResult?.formatted || prev.formattedRifPrice,
        rifCollateral: rifCollateralResult?.raw
          ? rifCollateralResult.raw.toString()
          : prev.rifCollateral,
        formattedRifCollateral: rifCollateralResult?.formatted || prev.formattedRifCollateral,
        maxMintable: maxMintable ? maxMintable.toString() : prev.maxMintable,
        formattedMaxMintable: formattedMaxMintable || prev.formattedMaxMintable,
        symbol: symbol || prev.symbol,
        name: name || prev.name,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      }))
      
      // Update history state
      setHistory({
        stRIFSupply: getMetricHistory('stRIFSupply'),
        rifproSupply: getMetricHistory('rifproSupply'),
        minted: getMetricHistory('minted'),
        rifPrice: getMetricHistory('rifPrice'),
        rifCollateral: getMetricHistory('rifCollateral'),
        maxMintable: getMetricHistory('maxMintable'),
      })
      
      // Clear refreshing indicators
      setRefreshingMetrics(new Set())
      if (isInitialLoad) {
        setIsInitialLoad(false)
      }
    } catch (error) {
      console.error('Error fetching token data:', error)

      if (isMountedRef.current) {
        setTokenData(prev => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch token data',
        }))
        setRefreshingMetrics(new Set())
        if (isInitialLoad) {
          setIsInitialLoad(false)
        }
      }
    }
  }, [getChecksummedAddress])

  // Fetch deployment count (only in production, as Vercel functions don't work in local dev)
  const fetchDeploymentCount = useCallback(async () => {
    // Skip in local development - Vercel serverless functions only work when deployed
    if (import.meta.env.DEV) {
      console.log('Skipping deployment count fetch in local development')
      return
    }

    try {
      console.log('Fetching deployment count from /api/analytics...')
      const response = await fetch('/api/analytics')
      console.log('Response status:', response.status, response.statusText)
      
      if (response.ok) {
        const contentType = response.headers.get('content-type')
        console.log('Content-Type:', contentType)
        
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json()
          console.log('Deployment count response:', data)
          if (data.totalDeployments !== undefined) {
            setDeploymentCount(data.totalDeployments)
            console.log('Set deployment count to:', data.totalDeployments)
          } else {
            console.warn('Response missing totalDeployments field:', data)
          }
        } else {
          const text = await response.text()
          console.error('Unexpected content type. Response:', text.substring(0, 200))
        }
      } else {
        console.error('Failed to fetch deployment count:', response.status, response.statusText)
        const errorText = await response.text()
        console.error('Error details:', errorText)
      }
    } catch (error) {
      console.error('Failed to fetch deployment count:', error)
      if (error instanceof Error) {
        console.error('Error message:', error.message)
        console.error('Error stack:', error.stack)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    
    // Load initial history
    setHistory({
      stRIFSupply: getMetricHistory('stRIFSupply'),
      rifproSupply: getMetricHistory('rifproSupply'),
      minted: getMetricHistory('minted'),
      rifPrice: getMetricHistory('rifPrice'),
      rifCollateral: getMetricHistory('rifCollateral'),
      maxMintable: getMetricHistory('maxMintable'),
    })
    
    fetchTokenData()
    fetchDeploymentCount()

    const interval = setInterval(() => {
      fetchTokenData()
    }, CONFIG.REFRESH_INTERVAL)

    return () => {
      isMountedRef.current = false
      clearInterval(interval)
    }
  }, [fetchTokenData, fetchDeploymentCount])

  return (
    <Routes>
      <Route path="/game" element={<LightCycleGame />} />
      <Route path="/" element={
        <div className="app">
          <div className="container">
            <header className="header">
              <div className="header-title-row">
                <h1>RIF PUT TO WORK</h1>
              </div>
              <p className="subtitle">Real-time token metrics on Rootstock</p>
              <div className="header-meta">
                {import.meta.env.VITE_GIT_COMMIT_HASH && (
                  <p className="git-hash">#{import.meta.env.VITE_GIT_COMMIT_HASH}</p>
                )}
                {deploymentCount !== null && (
                  <p className="deployment-count">Deployments: {deploymentCount} 😅</p>
                )}
              </div>
              <Link to="/game" className="game-link">Play Light Cycle →</Link>
            </header>

        <div className="card">
          <div className="card-header">
            <div className="card-header-title-row">
              <img 
                src="https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzFsMWMxMzQ0bnY2ZTd2ejA2ZjNkamVteG9nNmhtenVja3VrbWZ6aCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/B0yg6yWnfVpEA/giphy.gif" 
                alt="Animated GIF" 
                className="header-gif"
              />
              <h2>RIF Metrics</h2>
            </div>
            {tokenData.lastUpdated && (() => {
              const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
              const timeString = tokenData.lastUpdated.toLocaleTimeString()
              const timezoneDisplay = timezone.replace(/_/g, ' ')
              return (
                <span className="last-updated">
                  Last updated: {timeString} ({timezoneDisplay})
                </span>
              )
            })()}
          </div>

          {tokenData.error ? (
            <div className="error">
              <p>⚠️ Error: {tokenData.error}</p>
              <button onClick={fetchTokenData} className="retry-button">
                Retry
              </button>
            </div>
          ) : (
            <div className="metrics">
              <MetricDisplay
                label="Staked RIF in Collective"
                value={tokenData.formattedStRIFSupply}
                unit="stRIF"
                isRefreshing={refreshingMetrics.has('stRIFSupply')}
                history={history.stRIFSupply}
                helpText="Sourced from the stRIF token contract (totalSupply). Represents the total amount of RIF tokens staked in the collective."
              />
              <MetricDisplay
                label="RIFPRO Total Supply"
                value={tokenData.formattedRifproSupply}
                unit="RIFPRO"
                isRefreshing={refreshingMetrics.has('rifproSupply')}
                history={history.rifproSupply}
                helpText="Sourced from the RIFPRO token contract (totalSupply). Represents the total supply of RIFPRO tokens in circulation."
              />
              <MetricDisplay
                label="USDRIF Minted"
                value={tokenData.formattedMinted}
                unit="USD"
                isRefreshing={refreshingMetrics.has('minted')}
                history={history.minted}
                helpText="Sourced from the old USDRIF token contract (totalSupply). Represents the total amount of USDRIF tokens that have been minted."
              />
              <MetricDisplay
                label="RIF Price"
                value={tokenData.formattedRifPrice}
                unit="USD"
                formatOptions={{ maximumFractionDigits: 6, prefix: '$' }}
                isRefreshing={refreshingMetrics.has('rifPrice')}
                history={history.rifPrice}
                helpText="Sourced from the RLabs price feed oracle (0xbed51d83cc4676660e3fc3819dfad8238549b975) using the read() function. Represents the current RIF/USD price."
              />
              <MetricDisplay
                label="RIF Collateral Backing USDRIF"
                value={tokenData.formattedRifCollateral}
                unit="RIFPROF"
                isRefreshing={refreshingMetrics.has('rifCollateral')}
                history={history.rifCollateral}
                helpText="Sourced from MoC V2 Core contract (0xA27024Ed70035E46dba712609fc2Afa1c97aA36A) using getTotalACavailable(). Represents the total RIF collateral available in the system (~212M RIF)."
              />
              <MetricDisplay
                label="USDRIF Mintable"
                value={tokenData.formattedMaxMintable}
                unit="USD"
                isRefreshing={refreshingMetrics.has('maxMintable')}
                history={history.maxMintable}
                helpText="Calculated using: (Total RIF Collateral ÷ Coverage Ratio) × RIF Price - Already Minted USDRIF. Coverage ratio sourced from MoC V2 Core calcCtargemaCA() (~5.5). RIF price from MoC price feed for calculation."
              />
            </div>
          )}

          <div className="card-footer">
            <button
              onClick={fetchTokenData}
              className="refresh-button"
              disabled={refreshingMetrics.size > 0}
            >
              {refreshingMetrics.size > 0 ? 'Refreshing...' : 'Refresh Now'}
            </button>
            <p className="info">
              Auto-refreshes every {Math.round(CONFIG.REFRESH_INTERVAL / 1000)} seconds
            </p>
          </div>
        </div>

        <footer className="footer">
          <h3 className="footer-title">Contract Addresses</h3>
          <table className="address-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>RIF Token</td>
                <td>
                  <a
                    href="https://rootstock.blockscout.com/address/0x2AcC95758f8b5F583470ba265EB685a8F45fC9D5?tab=internal_txns"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="address-link"
                  >
                    <code>0x2AcC95758f8b5F583470ba265EB685a8F45fC9D5</code>
                  </a>
                </td>
              </tr>
              <tr>
                <td>stRIF</td>
                <td>
                  <a
                    href={`https://rootstock.blockscout.com/address/${CONFIG.STRIF_ADDRESS}?tab=internal_txns`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="address-link"
                  >
                    <code>{CONFIG.STRIF_ADDRESS}</code>
                  </a>
                </td>
              </tr>
              <tr>
                <td>USDRIF</td>
                <td>
                  <a
                    href={`https://rootstock.blockscout.com/address/${CONFIG.USDRIF_ADDRESS}?tab=internal_txns`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="address-link"
                  >
                    <code>{CONFIG.USDRIF_ADDRESS}</code>
                  </a>
                </td>
              </tr>
              <tr>
                <td>RIFPRO</td>
                <td>
                  <a
                    href={`https://rootstock.blockscout.com/address/${CONFIG.RIFPRO_ADDRESS}?tab=internal_txns`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="address-link"
                  >
                    <code>{CONFIG.RIFPRO_ADDRESS}</code>
                  </a>
                </td>
              </tr>
              <tr>
                <td>MoC V2 Core (RoC)</td>
                <td>
                  <a
                    href={`https://rootstock.blockscout.com/address/${CONFIG.MOC_V2_CORE}?tab=internal_txns`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="address-link"
                  >
                    <code>{CONFIG.MOC_V2_CORE}</code>
                  </a>
                </td>
              </tr>
              <tr>
                <td>RIF Price Feed (RLabs)</td>
                <td>
                  <a
                    href={`https://rootstock.blockscout.com/address/${CONFIG.RIF_PRICE_FEED_RLABS}?tab=internal_txns`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="address-link"
                  >
                    <code>{CONFIG.RIF_PRICE_FEED_RLABS}</code>
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </footer>
        </div>
      </div>
      } />
    </Routes>
  )
}

export default App
