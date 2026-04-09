import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { getMetricHistory, HistoryPoint, METRIC_KEYS } from '../history'
import { normalizeAddress } from '../utils/address'
import { logger } from '../utils/logger'
import { userFacingError } from '../utils/userFacingError'
import { CONFIG } from '../config'
import { fetchTokenChainSnapshot } from '../tokenData/fetchTokenChainSnapshot'
import { resolveWorkingProvider } from '../tokenData/resolveWorkingProvider'
import { INITIAL_TOKEN_DATA, type TokenData } from '../tokenData/types'

export type { TokenData } from '../tokenData/types'

export function useTokenData() {
  const [tokenData, setTokenData] = useState<TokenData>(INITIAL_TOKEN_DATA)
  const [refreshingMetrics, setRefreshingMetrics] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [isClientOutdated, setIsClientOutdated] = useState(false)

  const isMountedRef = useRef(true)
  const providerCacheRef = useRef<ethers.JsonRpcProvider | null>(null)
  const pollingIntervalRef = useRef<number | null>(null)

  const getChecksummedAddress = useCallback((address: string) => normalizeAddress(address), [])

  const fetchTokenData = useCallback(async () => {
    if (!isMountedRef.current) return

    try {
      setRefreshingMetrics(
        new Set([
          METRIC_KEYS.ST_RIF_SUPPLY,
          METRIC_KEYS.VAULTED_USDRIF,
          METRIC_KEYS.RIFPRO_SUPPLY,
          METRIC_KEYS.MINTED,
          METRIC_KEYS.RIF_PRICE,
          METRIC_KEYS.RIF_COLLATERAL,
          METRIC_KEYS.MAX_MINTABLE,
        ])
      )
      setTokenData((prev) => ({ ...prev, loading: true, error: null }))

      const provider = await resolveWorkingProvider(providerCacheRef)
      if (!provider) {
        throw new Error(
          'Unable to connect to any RSK RPC endpoint. Please check your network connection or configure VITE_ROOTSTOCK_RPC environment variable.'
        )
      }

      const snapshot = await fetchTokenChainSnapshot(provider, getChecksummedAddress)

      if (!isMountedRef.current) return

      setTokenData((prev) => ({
        ...prev,
        stRIFSupply: snapshot.stRIFSupply,
        formattedStRIFSupply: snapshot.formattedStRIFSupply ?? prev.formattedStRIFSupply,
        vaultedUsdrif: snapshot.vaultedUsdrif ?? prev.vaultedUsdrif,
        formattedVaultedUsdrif: snapshot.formattedVaultedUsdrif ?? prev.formattedVaultedUsdrif,
        rifproSupply: snapshot.rifproSupply,
        formattedRifproSupply: snapshot.formattedRifproSupply ?? prev.formattedRifproSupply,
        minted: snapshot.minted ?? prev.minted,
        formattedMinted: snapshot.formattedMinted ?? prev.formattedMinted,
        rifPrice: snapshot.rifPrice ?? prev.rifPrice,
        formattedRifPrice: snapshot.formattedRifPrice ?? prev.formattedRifPrice,
        rifCollateral: snapshot.rifCollateral ?? prev.rifCollateral,
        formattedRifCollateral: snapshot.formattedRifCollateral ?? prev.formattedRifCollateral,
        maxMintable: snapshot.maxMintable ?? prev.maxMintable,
        formattedMaxMintable: snapshot.formattedMaxMintable ?? prev.formattedMaxMintable,
        symbol: snapshot.symbol ?? prev.symbol,
        name: snapshot.name ?? prev.name,
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
            error:
              'Your browser is using an outdated version. Please refresh the page to get the latest version.',
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
  }, [getChecksummedAddress])

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
