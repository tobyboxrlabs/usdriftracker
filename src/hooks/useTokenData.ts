import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { CONFIG, ERC20_ABI, PRICE_FEED_ABI, MOC_CORE_ABI, STANDARD_DECIMALS } from '../config'
import { saveMetricHistory, getMetricHistory, HistoryPoint, METRIC_KEYS } from '../history'
import { normalizeAddress } from '../utils/address'
import { formatAmount as formatAmountUtil } from '../utils/amount'
import { logger } from '../utils/logger'
import { withBackoff } from '../utils/asyncRetry'
import { userFacingError } from '../utils/userFacingError'

export interface TokenData {
  stRIFSupply: string
  formattedStRIFSupply: string
  vaultedUsdrif: string | null
  formattedVaultedUsdrif: string | null
  rifproSupply: string
  formattedRifproSupply: string
  minted: string | null
  formattedMinted: string | null
  rifPrice: string | null
  formattedRifPrice: string | null
  rifCollateral: string | null
  formattedRifCollateral: string | null
  maxMintable: string | null
  formattedMaxMintable: string | null
  symbol: string
  name: string
  loading: boolean
  error: string | null
  lastUpdated: Date | null
}

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
 * Custom JsonRpcProvider that proxies requests through our API endpoint
 */
class ProxyJsonRpcProvider extends ethers.JsonRpcProvider {
  private proxyUrl: string

  constructor(targetEndpoint: string) {
    const proxyUrl = `/api/rpc?target=${encodeURIComponent(targetEndpoint)}`
    super(proxyUrl)
    this.proxyUrl = proxyUrl
  }

  async _send(payload: ethers.JsonRpcPayload | Array<ethers.JsonRpcPayload>): Promise<Array<ethers.JsonRpcResult>> {
    const payloads = Array.isArray(payload) ? payload : [payload]

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
            logger.rpc.error(`RPC proxy error ${response.status}:`, errorText.substring(0, 200))

            if (response.status === 410) {
              try {
                const errorData = JSON.parse(errorText)
                if (errorData.code === 'OUTDATED_CLIENT') {
                  logger.rpc.warn('Client version outdated - stopping polling')
                  throw new Error('OUTDATED_CLIENT')
                }
              } catch {
                if (response.status === 410) {
                  logger.rpc.warn('Received 410 Gone - client may be outdated')
                  throw new Error('OUTDATED_CLIENT')
                }
              }
            }

            throw new Error(`RPC proxy error: ${response.status} - ${errorText.substring(0, 100)}`)
          }

          const result = await response.json()
          if (result.error) {
            logger.rpc.error('JSON-RPC error:', result.error)
          }
          return result
        } catch (fetchError) {
          logger.rpc.error('Fetch error:', fetchError)
          throw fetchError
        }
      })
    )

    return results as Array<ethers.JsonRpcResult>
  }
}

export function useTokenData() {
  const [tokenData, setTokenData] = useState<TokenData>(INITIAL_TOKEN_DATA)
  const [refreshingMetrics, setRefreshingMetrics] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [isClientOutdated, setIsClientOutdated] = useState(false)

  const isMountedRef = useRef(true)
  const providerCacheRef = useRef<ethers.JsonRpcProvider | null>(null)
  const pollingIntervalRef = useRef<number | null>(null)

  const getChecksummedAddress = useCallback((address: string) => normalizeAddress(address), [])

  const getWorkingProvider = useCallback(async (): Promise<ethers.JsonRpcProvider | null> => {
    if (providerCacheRef.current) {
      try {
        await providerCacheRef.current.getBlockNumber()
        return providerCacheRef.current
      } catch {
        logger.tokenData.warn('Cached provider failed, creating new instance')
        providerCacheRef.current = null
      }
    }

    const endpoints = [CONFIG.ROOTSTOCK_RPC, ...(CONFIG.ROOTSTOCK_RPC_ALTERNATIVES || [])]
    const isDev = import.meta.env.DEV

    if (!isDev) {
      for (const endpoint of endpoints) {
        try {
          const provider = await withBackoff(
            async () => {
              const p = new ProxyJsonRpcProvider(endpoint)
              await p.getBlockNumber()
              return p
            },
            { maxAttempts: 3, baseDelayMs: 400 }
          )
          logger.rpc.info(`Using RPC proxy: ${endpoint}`)
          providerCacheRef.current = provider
          return provider
        } catch {
          continue
        }
      }
    }

    for (const endpoint of endpoints) {
      try {
        const provider = await withBackoff(
          async () => {
            const p = new ethers.JsonRpcProvider(endpoint)
            await p.getBlockNumber()
            return p
          },
          { maxAttempts: 3, baseDelayMs: 400 }
        )
        logger.rpc.info(`Using direct RPC: ${endpoint}`)
        providerCacheRef.current = provider
        return provider
      } catch (error) {
        if (error instanceof Error && (
          error.message.includes('CORS') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('network') ||
          error.message.includes('ERR_FAILED') ||
          error.message.includes('ERR_CONNECTION')
        )) {
          continue
        }
        if (!isDev) {
          logger.rpc.warn(`RPC endpoint ${endpoint} failed, trying next...`, error)
        }
        continue
      }
    }

    logger.rpc.error('All RPC endpoints failed')
    return null
  }, [])

  const queryOptionalMetric = useCallback(
    async (
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
        const formatted = formatAmountUtil(raw, decimals)
        return { raw, formatted }
      } catch (error) {
        logger.tokenData.warn(`Failed to query metric from ${address}:`, error)
        return null
      }
    },
    [getChecksummedAddress]
  )

  const fetchTokenData = useCallback(async () => {
    if (!isMountedRef.current) return

    try {
      setRefreshingMetrics(new Set([
        METRIC_KEYS.ST_RIF_SUPPLY,
        METRIC_KEYS.VAULTED_USDRIF,
        METRIC_KEYS.RIFPRO_SUPPLY,
        METRIC_KEYS.MINTED,
        METRIC_KEYS.RIF_PRICE,
        METRIC_KEYS.RIF_COLLATERAL,
        METRIC_KEYS.MAX_MINTABLE,
      ]))
      setTokenData((prev) => ({ ...prev, loading: true, error: null }))

      const provider = await getWorkingProvider()
      if (!provider) {
        throw new Error('Unable to connect to any RSK RPC endpoint. Please check your network connection or configure VITE_ROOTSTOCK_RPC environment variable.')
      }

      const stRIFContract = new ethers.Contract(getChecksummedAddress(CONFIG.STRIF_ADDRESS), ERC20_ABI, provider)
      const rifproContract = new ethers.Contract(getChecksummedAddress(CONFIG.RIFPRO_ADDRESS), ERC20_ABI, provider)
      const usdrifContract = new ethers.Contract(getChecksummedAddress(CONFIG.USDRIF_ADDRESS), ERC20_ABI, provider)
      const vusdContract = new ethers.Contract(getChecksummedAddress(CONFIG.VUSD_ADDRESS), ERC20_ABI, provider)

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

      if (!isMountedRef.current) return

      const stRIFDecimals = Number(stRIFDecimalsRaw)
      const rifproDecimals = Number(rifproDecimalsRaw)
      const USDRIFDecimals = Number(USDRIFDecimalsRaw)
      const VUSDDecimals = Number(VUSDDecimalsRaw)

      const formattedStRIFSupply = formatAmountUtil(stRIFSupply, stRIFDecimals)
      const formattedRifproSupply = formatAmountUtil(rifproSupply, rifproDecimals)
      const formattedMinted = formatAmountUtil(USDRIFSupply, USDRIFDecimals)
      const formattedVaultedUsdrif = formatAmountUtil(VUSDSupply, VUSDDecimals)

      const rifPriceResult = await queryOptionalMetric(
        provider,
        CONFIG.RIF_PRICE_FEED_RLABS,
        PRICE_FEED_ABI,
        async (contract) => await contract.read(),
        18
      )

      const rifPriceMocResult = await queryOptionalMetric(
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

      let maxMintable: bigint | null = null
      let formattedMaxMintable: string | null = null

      if (rifCollateralResult && rifPriceMocResult && formattedMinted) {
        try {
          const targetCoverageResult = await queryOptionalMetric(
            provider,
            CONFIG.MOC_V2_CORE,
            MOC_CORE_ABI,
            async (contract) => await contract.calcCtargemaCA(),
            STANDARD_DECIMALS
          )

          if (targetCoverageResult) {
            const totalRifCollateral = rifCollateralResult.raw
            const coverageRatio = targetCoverageResult.raw
            const rifPrice = rifPriceMocResult.raw
            const mintedUsdrif = USDRIFSupply

            const usdEquivRatioDRif = (totalRifCollateral * rifPrice) / coverageRatio
            const mintableUsdrif = usdEquivRatioDRif > mintedUsdrif ? usdEquivRatioDRif - mintedUsdrif : 0n

            maxMintable = mintableUsdrif
            formattedMaxMintable = formatAmountUtil(mintableUsdrif, STANDARD_DECIMALS)
          }
        } catch {
          logger.tokenData.warn('Failed to calculate USDRIF Mintable')
        }
      }

      if (!isMountedRef.current) return

      const metricKeys = {
        stRIFSupply: parseFloat(formattedStRIFSupply),
        vaultedUsdrif: parseFloat(formattedVaultedUsdrif),
        rifproSupply: parseFloat(formattedRifproSupply),
        minted: parseFloat(formattedMinted),
        rifPrice: rifPriceResult?.formatted ? parseFloat(rifPriceResult.formatted) : null,
        rifCollateral: rifCollateralResult?.formatted ? parseFloat(rifCollateralResult.formatted) : null,
        maxMintable: formattedMaxMintable ? parseFloat(formattedMaxMintable) : null,
      }

      Object.entries(metricKeys).forEach(([key, value]) => {
        if (value !== null && !isNaN(value)) {
          saveMetricHistory(key, value)
        }
      })

      const historyCounts = Object.fromEntries(
        Object.keys(metricKeys).map((key) => [key, getMetricHistory(key).length])
      )
      logger.tokenData.debug('History data points:', historyCounts)
      logger.tokenData.info('Token data refreshed:', {
        stRIF: formattedStRIFSupply,
        vaulted: formattedVaultedUsdrif,
        rifpro: formattedRifproSupply,
        minted: formattedMinted,
      })

      setTokenData((prev) => ({
        stRIFSupply: stRIFSupply != null ? stRIFSupply.toString() : prev.stRIFSupply,
        formattedStRIFSupply: formattedStRIFSupply ?? prev.formattedStRIFSupply,
        vaultedUsdrif: VUSDSupply != null ? VUSDSupply.toString() : prev.vaultedUsdrif,
        formattedVaultedUsdrif: formattedVaultedUsdrif ?? prev.formattedVaultedUsdrif,
        rifproSupply: rifproSupply != null ? rifproSupply.toString() : prev.rifproSupply,
        formattedRifproSupply: formattedRifproSupply ?? prev.formattedRifproSupply,
        minted: USDRIFSupply != null ? USDRIFSupply.toString() : prev.minted,
        formattedMinted: formattedMinted ?? prev.formattedMinted,
        rifPrice: rifPriceResult?.raw != null ? rifPriceResult.raw.toString() : prev.rifPrice,
        formattedRifPrice: rifPriceResult?.formatted ?? prev.formattedRifPrice,
        rifCollateral:
          rifCollateralResult?.raw != null ? rifCollateralResult.raw.toString() : prev.rifCollateral,
        formattedRifCollateral: rifCollateralResult?.formatted ?? prev.formattedRifCollateral,
        maxMintable: maxMintable != null ? maxMintable.toString() : prev.maxMintable,
        formattedMaxMintable: formattedMaxMintable ?? prev.formattedMaxMintable,
        symbol: symbol ?? prev.symbol,
        name: name ?? prev.name,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      }))

      setHistory({
        stRIFSupply: getMetricHistory(METRIC_KEYS.ST_RIF_SUPPLY),
        vaultedUsdrif: getMetricHistory(METRIC_KEYS.VAULTED_USDRIF),
        rifproSupply: getMetricHistory(METRIC_KEYS.RIFPRO_SUPPLY),
        minted: getMetricHistory(METRIC_KEYS.MINTED),
        rifPrice: getMetricHistory(METRIC_KEYS.RIF_PRICE),
        rifCollateral: getMetricHistory(METRIC_KEYS.RIF_COLLATERAL),
        maxMintable: getMetricHistory(METRIC_KEYS.MAX_MINTABLE),
      })

      setRefreshingMetrics(new Set())
    } catch (error) {
      logger.tokenData.error('Error fetching token data:', error)

      if (isMountedRef.current) {
        if (error instanceof Error && error.message === 'OUTDATED_CLIENT') {
          logger.tokenData.warn('Client version outdated - stopping polling')
          setIsClientOutdated(true)
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }
          providerCacheRef.current = null
          setTokenData((prev) => ({
            ...prev,
            loading: false,
            error: 'Your browser is using an outdated version. Please refresh the page to get the latest version.',
          }))
        } else {
          setTokenData((prev) => ({
            ...prev,
            loading: false,
            error: userFacingError(error),
          }))
        }
        setRefreshingMetrics(new Set())
      }
    }
  }, [getChecksummedAddress, getWorkingProvider, queryOptionalMetric])

  useEffect(() => {
    isMountedRef.current = true

    setHistory({
      stRIFSupply: getMetricHistory(METRIC_KEYS.ST_RIF_SUPPLY),
      vaultedUsdrif: getMetricHistory(METRIC_KEYS.VAULTED_USDRIF),
      rifproSupply: getMetricHistory(METRIC_KEYS.RIFPRO_SUPPLY),
      minted: getMetricHistory(METRIC_KEYS.MINTED),
      rifPrice: getMetricHistory(METRIC_KEYS.RIF_PRICE),
      rifCollateral: getMetricHistory(METRIC_KEYS.RIF_COLLATERAL),
      maxMintable: getMetricHistory(METRIC_KEYS.MAX_MINTABLE),
    })

    if (!isClientOutdated) {
      fetchTokenData()
      pollingIntervalRef.current = window.setInterval(() => {
        fetchTokenData()
      }, CONFIG.REFRESH_INTERVAL)
    }

    return () => {
      isMountedRef.current = false
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      providerCacheRef.current = null
    }
  }, [fetchTokenData, isClientOutdated])

  return { tokenData, refreshingMetrics, history, isClientOutdated, fetchTokenData }
}
