import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Routes, Route, Link, Navigate } from 'react-router-dom'
import { ethers } from 'ethers'
import { CONFIG, ERC20_ABI, PRICE_FEED_ABI, MOC_CORE_ABI, STANDARD_DECIMALS } from './config'
import { saveMetricHistory, getMetricHistory, HistoryPoint, METRIC_KEYS } from './history'
import { normalizeAddress } from './utils/address'
import { MiniLineGraph } from './MiniLineGraph'
import LightCycleGame from './LightCycleGame'
import Analytics from './Analytics'
import './App.css'

/**
 * Token metric data structure
 * Only includes fields that are actively used and displayed
 */
interface TokenData {
  // Token supplies
  stRIFSupply: string
  formattedStRIFSupply: string
  vaultedUsdrif: string | null
  formattedVaultedUsdrif: string | null
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
  vaultedUsdrif: null,
  formattedVaultedUsdrif: null,
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

  const toggleTooltip = useCallback(() => {
    setIsTooltipVisible(prev => !prev)
  }, [])

  const closeTooltip = useCallback(() => {
    setIsTooltipVisible(false)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleTooltip()
    } else if (e.key === 'Escape') {
      closeTooltip()
    }
  }, [toggleTooltip, closeTooltip])

  // Close tooltip on Escape key press globally
  useEffect(() => {
    if (isTooltipVisible) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          closeTooltip()
        }
      }
      window.addEventListener('keydown', handleEscape)
      return () => window.removeEventListener('keydown', handleEscape)
    }
  }, [isTooltipVisible, closeTooltip])

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
                role="button"
                tabIndex={0}
                aria-expanded={isTooltipVisible}
                aria-label="More information about this metric"
                onMouseEnter={() => setIsTooltipVisible(true)}
                onMouseLeave={() => setIsTooltipVisible(false)}
                onClick={toggleTooltip}
                onKeyDown={handleKeyDown}
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
                  role="button"
                  tabIndex={0}
                  aria-expanded={isTooltipVisible}
                  aria-label="More information about this metric"
                  onMouseEnter={() => setIsTooltipVisible(true)}
                  onMouseLeave={() => setIsTooltipVisible(false)}
                  onClick={toggleTooltip}
                  onKeyDown={handleKeyDown}
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
  const [isClientOutdated, setIsClientOutdated] = useState(false)

  // Track component mount state to prevent state updates after unmount
  const isMountedRef = useRef(true)
  
  // Cache provider instance to avoid creating new provider per request
  const providerCacheRef = useRef<ethers.JsonRpcProvider | null>(null)
  const pollingIntervalRef = useRef<number | null>(null)

  // Use centralized address normalization utility
  const getChecksummedAddress = useCallback((address: string): string => {
    return normalizeAddress(address)
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
   * Custom JsonRpcProvider that proxies requests through our API endpoint
   */
  class ProxyJsonRpcProvider extends ethers.JsonRpcProvider {
    private proxyUrl: string
    
    constructor(targetEndpoint: string) {
      // Construct proxy URL with target endpoint
      const proxyUrl = `/api/rpc?target=${encodeURIComponent(targetEndpoint)}`
      // Pass proxy URL to super - ethers.js will use it, but we override _send to intercept
      super(proxyUrl)
      this.proxyUrl = proxyUrl
    }
    
    // Override _send to intercept RPC calls and proxy them
    async _send(payload: ethers.JsonRpcPayload | Array<ethers.JsonRpcPayload>): Promise<Array<ethers.JsonRpcResult>> {
      // Convert payload to array if single
      const payloads = Array.isArray(payload) ? payload : [payload]
      
      // Forward each request through our proxy
      const results = await Promise.all(
        payloads.map(async (p) => {
          try {
            const response = await fetch(this.proxyUrl, {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'X-Client-Version': CONFIG.CLIENT_VERSION,
              },
              body: JSON.stringify(p),
            })
            
            if (!response.ok) {
              const errorText = await response.text()
              console.error(`[ProxyJsonRpcProvider] RPC proxy error ${response.status}:`, errorText.substring(0, 200))
              
              // Check if this is a 410 Gone response indicating outdated client
              if (response.status === 410) {
                try {
                  const errorData = JSON.parse(errorText)
                  if (errorData.code === 'OUTDATED_CLIENT') {
                    console.warn('[ProxyJsonRpcProvider] ⚠️ Client version outdated - stopping polling')
                    // Signal that client is outdated (will be handled by parent component)
                    throw new Error('OUTDATED_CLIENT')
                  }
                } catch (parseError) {
                  // If we can't parse the error, still treat 410 as outdated client
                  if (response.status === 410) {
                    console.warn('[ProxyJsonRpcProvider] ⚠️ Received 410 Gone - client may be outdated')
                    throw new Error('OUTDATED_CLIENT')
                  }
                }
              }
              
              throw new Error(`RPC proxy error: ${response.status} - ${errorText.substring(0, 100)}`)
            }
            
            const result = await response.json()
            
            // Check for JSON-RPC error in response
            if (result.error) {
              console.error(`[ProxyJsonRpcProvider] JSON-RPC error:`, result.error)
            }
            
            return result
          } catch (fetchError) {
            console.error(`[ProxyJsonRpcProvider] Fetch error:`, fetchError)
            throw fetchError
          }
        })
      )
      
      return results as Array<ethers.JsonRpcResult>
    }
  }

  /**
   * Get a working RPC provider by trying multiple endpoints
   * In production, uses proxy endpoint to avoid CORS issues
   * Falls back to direct endpoints if proxy fails
   * Caches provider instance to avoid creating new provider per request
   */
  const getWorkingProvider = useCallback(async (): Promise<ethers.JsonRpcProvider | null> => {
    // Return cached provider if available and still working
    if (providerCacheRef.current) {
      try {
        // Quick health check - this will use cached eth_chainId/blockNumber from our RPC cache
        await providerCacheRef.current.getBlockNumber()
        return providerCacheRef.current
      } catch (error) {
        // Provider failed, clear cache and create new one
        console.warn('[provider] Cached provider failed, creating new instance:', error)
        providerCacheRef.current = null
      }
    }

    const endpoints = CONFIG.ROOTSTOCK_RPC_ALTERNATIVES || [CONFIG.ROOTSTOCK_RPC]
    const isDev = import.meta.env.DEV
    
    // In production (or vercel dev): try proxy first (avoids CORS)
    // In dev with plain vite: skip proxy (it 404s), go straight to direct
    if (!isDev) {
      for (const endpoint of endpoints) {
        try {
          const provider = new ProxyJsonRpcProvider(endpoint)
          await provider.getBlockNumber()
          console.log(`✅ Using RPC proxy: ${endpoint}`)
          providerCacheRef.current = provider
          return provider
        } catch (error) {
          continue
        }
      }
    }
    
    // Direct endpoints (dev fallback when proxy unavailable, or production fallback)
    for (const endpoint of endpoints) {
      try {
        const provider = new ethers.JsonRpcProvider(endpoint)
        // Test connection by attempting to get block number
        await provider.getBlockNumber()
        console.log(`✅ Using direct RPC endpoint: ${endpoint}`)
        
        // Cache the provider instance
        providerCacheRef.current = provider
        return provider
      } catch (error) {
        // Silently skip CORS/network errors (they're expected for some endpoints)
        // This prevents console spam while still allowing the app to try all endpoints
        if (error instanceof Error && (
          error.message.includes('CORS') || 
          error.message.includes('Failed to fetch') ||
          error.message.includes('network') ||
          error.message.includes('ERR_FAILED') ||
          error.message.includes('ERR_CONNECTION')
        )) {
          // Silently continue to next endpoint without logging
          continue
        }
        // Only log non-CORS errors (actual RPC errors)
        if (!isDev) {
          console.warn(`RPC endpoint ${endpoint} failed, trying next...`, error)
        }
        continue
      }
    }
    
    console.error('❌ All RPC endpoints failed')
    return null
  }, [])

  /**
   * Query optional metric from contract
   * Returns null if query fails, allowing app to continue without the metric
   */
  const queryOptionalMetric = async (
    provider: ethers.Provider,
    address: string,
    abi: readonly string[],
    queryFn: (contract: ethers.Contract) => Promise<bigint>,
    decimals: number = STANDARD_DECIMALS
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
        METRIC_KEYS.ST_RIF_SUPPLY,
        METRIC_KEYS.VAULTED_USDRIF,
        METRIC_KEYS.RIFPRO_SUPPLY,
        METRIC_KEYS.MINTED,
        METRIC_KEYS.RIF_PRICE,
        METRIC_KEYS.RIF_COLLATERAL,
        METRIC_KEYS.MAX_MINTABLE,
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
      const usdrifContract = new ethers.Contract(
        getChecksummedAddress(CONFIG.USDRIF_ADDRESS),
        ERC20_ABI,
        provider
      )
      const vusdContract = new ethers.Contract(
        getChecksummedAddress(CONFIG.VUSD_ADDRESS),
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
        VUSDSupply,
        VUSDDecimalsRaw,
        name,
        symbol,
      ] = await Promise.all([
        stRIFContract.totalSupply(),
        stRIFContract.decimals(),
        rifproContract.totalSupply(),
        rifproContract.decimals(),
        usdrifContract.totalSupply(),
        usdrifContract.decimals(),
        vusdContract.totalSupply(),
        vusdContract.decimals(),
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
      const VUSDDecimals = Number(VUSDDecimalsRaw)

      // Format token supplies
      const formattedStRIFSupply = formatAmount(stRIFSupply, stRIFDecimals)
      const formattedRifproSupply = formatAmount(rifproSupply, rifproDecimals)
      const formattedMinted = formatAmount(USDRIFSupply, USDRIFDecimals)
      const formattedVaultedUsdrif = formatAmount(VUSDSupply, VUSDDecimals)

      // Query optional metrics (these may fail without breaking the app)
      const rifPriceResult = await queryOptionalMetric(
        provider,
        CONFIG.RIF_PRICE_FEED_RLABS,
        PRICE_FEED_ABI,
        async (contract) => await contract.read(),
        18
      )

      // Query MoC price feed for mintable calculation (may differ from RLabs)
      const rifPriceMocResult = await         queryOptionalMetric(
          provider,
          CONFIG.RIF_PRICE_FEED_MOC,
          PRICE_FEED_ABI,
          async (contract) => await contract.read(),
          STANDARD_DECIMALS
        )

      const rifCollateralResult = await queryOptionalMetric(
        provider,
        CONFIG.MOC_V2_CORE,
        MOC_CORE_ABI,
        async (contract) => await contract.getTotalACavailable(),
        STANDARD_DECIMALS
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
          const targetCoverageResult = await         queryOptionalMetric(
          provider,
          CONFIG.MOC_V2_CORE,
          MOC_CORE_ABI,
          async (contract) => await contract.calcCtargemaCA(),
          STANDARD_DECIMALS
        )

          if (targetCoverageResult) {
            // Use BigInt math end-to-end to preserve precision
            // All values are already in BigInt with 18 decimals
            
            // Step 1: Total RIF Collateral (BigInt, 18 decimals)
            const totalRifCollateral = rifCollateralResult.raw // Already BigInt with 18 decimals
            
            // Step 2: Coverage Ratio (BigInt, 18 decimals) - e.g., 5.5 = 5500000000000000000n
            const coverageRatio = targetCoverageResult.raw // Already BigInt with 18 decimals
            
            // Step 3: RIF/USD Price (BigInt, 18 decimals)
            const rifPrice = rifPriceMocResult.raw // Already BigInt with 18 decimals
            
            // Step 4: Already Minted USDRIF (BigInt, 18 decimals)
            const mintedUsdrif = USDRIFSupply // Already BigInt with 18 decimals
            
            // Step 5: Calculate mintable using fixed-point BigInt math:
            // Formula: (TotalRIFCollateral * RIFPrice) / CoverageRatio - MintedUSDRIF
            // All values are in 18 decimals, so:
            // - TotalRIFCollateral * RIFPrice = result in 36 decimals
            // - Divide by CoverageRatio = result in 18 decimals
            // - Subtract MintedUSDRIF = final result in 18 decimals
            
            // Calculate: (totalRifCollateral * rifPrice) / coverageRatio
            // Multiply first (36 decimals), then divide by coverageRatio (back to 18 decimals)
            const usdEquivRatioDRif = (totalRifCollateral * rifPrice) / coverageRatio
            
            // Step 6: Mintable USDRIF = USD Equiv Ratio'd RIF - Already Minted
            // Both are in 18 decimals, so subtraction is safe
            const mintableUsdrif = usdEquivRatioDRif > mintedUsdrif 
              ? usdEquivRatioDRif - mintedUsdrif 
              : 0n
            
            // Set results
            maxMintable = mintableUsdrif
            formattedMaxMintable = formatAmount(mintableUsdrif, STANDARD_DECIMALS)
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
        vaultedUsdrif: parseFloat(formattedVaultedUsdrif),
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
      // Use explicit null/undefined checks to avoid falsy 0n being treated as "no value"
      setTokenData(prev => ({
        stRIFSupply: stRIFSupply !== null && stRIFSupply !== undefined ? stRIFSupply.toString() : prev.stRIFSupply,
        formattedStRIFSupply: formattedStRIFSupply !== null && formattedStRIFSupply !== undefined ? formattedStRIFSupply : prev.formattedStRIFSupply,
        vaultedUsdrif: VUSDSupply !== null && VUSDSupply !== undefined ? VUSDSupply.toString() : prev.vaultedUsdrif,
        formattedVaultedUsdrif: formattedVaultedUsdrif !== null && formattedVaultedUsdrif !== undefined ? formattedVaultedUsdrif : prev.formattedVaultedUsdrif,
        rifproSupply: rifproSupply !== null && rifproSupply !== undefined ? rifproSupply.toString() : prev.rifproSupply,
        formattedRifproSupply: formattedRifproSupply !== null && formattedRifproSupply !== undefined ? formattedRifproSupply : prev.formattedRifproSupply,
        minted: USDRIFSupply !== null && USDRIFSupply !== undefined ? USDRIFSupply.toString() : prev.minted,
        formattedMinted: formattedMinted !== null && formattedMinted !== undefined ? formattedMinted : prev.formattedMinted,
        rifPrice: rifPriceResult?.raw !== null && rifPriceResult?.raw !== undefined ? rifPriceResult.raw.toString() : prev.rifPrice,
        formattedRifPrice: rifPriceResult?.formatted !== null && rifPriceResult?.formatted !== undefined ? rifPriceResult.formatted : prev.formattedRifPrice,
        rifCollateral: rifCollateralResult?.raw !== null && rifCollateralResult?.raw !== undefined
          ? rifCollateralResult.raw.toString()
          : prev.rifCollateral,
        formattedRifCollateral: rifCollateralResult?.formatted !== null && rifCollateralResult?.formatted !== undefined ? rifCollateralResult.formatted : prev.formattedRifCollateral,
        maxMintable: maxMintable !== null && maxMintable !== undefined ? maxMintable.toString() : prev.maxMintable,
        formattedMaxMintable: formattedMaxMintable !== null && formattedMaxMintable !== undefined ? formattedMaxMintable : prev.formattedMaxMintable,
        symbol: symbol !== null && symbol !== undefined ? symbol : prev.symbol,
        name: name !== null && name !== undefined ? name : prev.name,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      }))
      
      // Update history state
      setHistory({
        stRIFSupply: getMetricHistory(METRIC_KEYS.ST_RIF_SUPPLY),
        vaultedUsdrif: getMetricHistory(METRIC_KEYS.VAULTED_USDRIF),
        rifproSupply: getMetricHistory(METRIC_KEYS.RIFPRO_SUPPLY),
        minted: getMetricHistory(METRIC_KEYS.MINTED),
        rifPrice: getMetricHistory(METRIC_KEYS.RIF_PRICE),
        rifCollateral: getMetricHistory(METRIC_KEYS.RIF_COLLATERAL),
        maxMintable: getMetricHistory(METRIC_KEYS.MAX_MINTABLE),
      })
      
      // Clear refreshing indicators
      setRefreshingMetrics(new Set())
      if (isInitialLoad) {
        setIsInitialLoad(false)
      }
    } catch (error) {
      console.error('Error fetching token data:', error)

      if (isMountedRef.current) {
        // Check if error is due to outdated client
        if (error instanceof Error && error.message === 'OUTDATED_CLIENT') {
          console.warn('[App] Client version outdated - stopping polling')
          setIsClientOutdated(true)
          
          // Stop polling interval
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }
          
          // Clear provider cache
          providerCacheRef.current = null
          
          // Set error state with user-friendly message
          setTokenData(prev => ({
            ...prev,
            loading: false,
            error: 'Your browser is using an outdated version. Please refresh the page to get the latest version.',
          }))
        } else {
          // Regular error handling
          setTokenData(prev => ({
            ...prev,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to fetch token data',
          }))
        }
        
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
      const response = await fetch('/api/analytics', {
        headers: {
          'X-Client-Version': CONFIG.CLIENT_VERSION,
        },
      })
      console.log('Response status:', response.status, response.statusText)
      
      if (response.ok) {
        const contentType = response.headers.get('content-type')
        console.log('Content-Type:', contentType)
        
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json()
          console.log('Deployment count response:', data)
          
          // Check if analytics is configured
          if (data.message === 'Analytics not configured') {
            console.warn('Analytics not configured - VERCEL_API_TOKEN missing in Vercel environment variables')
            setDeploymentCount(null) // Don't show 0, show nothing
            return
          }
          
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
      stRIFSupply: getMetricHistory(METRIC_KEYS.ST_RIF_SUPPLY),
      vaultedUsdrif: getMetricHistory(METRIC_KEYS.VAULTED_USDRIF),
      rifproSupply: getMetricHistory(METRIC_KEYS.RIFPRO_SUPPLY),
      minted: getMetricHistory(METRIC_KEYS.MINTED),
      rifPrice: getMetricHistory(METRIC_KEYS.RIF_PRICE),
      rifCollateral: getMetricHistory(METRIC_KEYS.RIF_COLLATERAL),
      maxMintable: getMetricHistory(METRIC_KEYS.MAX_MINTABLE),
    })
    
    fetchTokenData()
    fetchDeploymentCount()

    // Store interval reference so we can clear it if client becomes outdated
    pollingIntervalRef.current = window.setInterval(() => {
      // Don't poll if client is outdated
      if (!isClientOutdated) {
        fetchTokenData()
      }
    }, CONFIG.REFRESH_INTERVAL)

    return () => {
      isMountedRef.current = false
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      // Clear provider cache on unmount
      providerCacheRef.current = null
    }
  }, [fetchTokenData, fetchDeploymentCount, isClientOutdated])

  return (
    <Routes>
      <Route path="/game" element={<LightCycleGame />} />
      <Route path="/tools" element={<Navigate to="/analytics" replace />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/" element={
        <div className="app">
          <div className="container">
            <header className="header">
              <div className="header-title-row">
                <h1>PUT RIF TO WORK</h1>
              </div>
              <p className="subtitle">Real-time token metrics on Rootstock</p>
              <div className="header-meta">
                {import.meta.env.VITE_GIT_COMMIT_HASH && (
                  <p className="git-hash">#{import.meta.env.VITE_GIT_COMMIT_HASH}</p>
                )}
                {deploymentCount !== null && deploymentCount > 0 && (
                  <p className="deployment-count">Deployments: {deploymentCount} 😅</p>
                )}
              </div>
              <div className="header-actions">
                <Link to="/analytics" className="analytics-link">Analytics</Link>
                <Link to="/game" className="game-link">Play Light Cycle →</Link>
              </div>
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

          {isClientOutdated ? (
            <div className="error" style={{ 
              backgroundColor: '#ff6b6b', 
              color: 'white', 
              padding: '20px', 
              borderRadius: '8px',
              textAlign: 'center',
              marginBottom: '20px'
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '10px' }}>⚠️ Client Version Outdated</h3>
              <p style={{ marginBottom: '15px' }}>
                Your browser is using an outdated version of this application. 
                Please refresh the page to get the latest version.
              </p>
              <button 
                onClick={() => window.location.reload()} 
                className="retry-button"
                style={{
                  backgroundColor: 'white',
                  color: '#ff6b6b',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Refresh Page
              </button>
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
              <MetricDisplay
                label="Staked RIF in Collective"
                value={tokenData.formattedStRIFSupply}
                unit="stRIF"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.ST_RIF_SUPPLY)}
                history={history.stRIFSupply}
                helpText="Sourced from the stRIF token contract (totalSupply). Represents the total amount of RIF tokens staked in the collective."
              />
              <MetricDisplay
                label="RIFPRO Total Supply"
                value={tokenData.formattedRifproSupply}
                unit="RIFPRO"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.RIFPRO_SUPPLY)}
                history={history.rifproSupply}
                helpText="Sourced from the RIFPRO token contract (totalSupply). Represents the total supply of RIFPRO tokens in circulation."
              />
              <MetricDisplay
                label="USDRIF Minted"
                value={tokenData.formattedMinted}
                unit="USD"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.MINTED)}
                history={history.minted}
                helpText="Sourced from the USDRIF token contract (totalSupply). Represents the total amount of USDRIF tokens that have been minted."
              />
              <MetricDisplay
                label="Staked USDRIF in USD Vault"
                value={tokenData.formattedVaultedUsdrif}
                unit="VUSD"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.VAULTED_USDRIF)}
                history={history.vaultedUsdrif}
                helpText="Sourced from the VUSD token contract (0xd8169270417050dCEf119597a7F6F5EE98dd2fd3) using totalSupply(). Represents the total amount of USDRIF staked in the USD vault."
              />
              <MetricDisplay
                label="RIF Price"
                value={tokenData.formattedRifPrice}
                unit="USD"
                formatOptions={{ maximumFractionDigits: 6, prefix: '$' }}
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.RIF_PRICE)}
                history={history.rifPrice}
                helpText="Sourced from the RLabs price feed oracle (0xbed51d83cc4676660e3fc3819dfad8238549b975) using the read() function. Represents the current RIF/USD price."
              />
              <MetricDisplay
                label="RIF Collateral Backing USDRIF"
                value={tokenData.formattedRifCollateral}
                unit="RIFPRO"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.RIF_COLLATERAL)}
                history={history.rifCollateral}
                helpText="Sourced from MoC V2 Core contract (0xA27024Ed70035E46dba712609fc2Afa1c97aA36A) using getTotalACavailable(). Represents the total RIF collateral available in the system (~212M RIF)."
              />
              <MetricDisplay
                label="USDRIF Mintable"
                value={tokenData.formattedMaxMintable}
                unit="USD"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.MAX_MINTABLE)}
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
              aria-busy={refreshingMetrics.size > 0}
              aria-live="polite"
            >
              {refreshingMetrics.size > 0 && <span className="refresh-spinner"></span>}
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
