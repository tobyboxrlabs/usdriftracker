import { ethers } from 'ethers'
import { CONFIG, ERC20_ABI, PRICE_FEED_ABI, MOC_CORE_ABI, STANDARD_DECIMALS } from '../config'
import { saveMetricHistory, getMetricHistory } from '../history'
import { formatAmount as formatAmountUtil } from '../utils/amount'
import { logger } from '../utils/logger'
import { calcHandRolledUsdrifMintable } from './calcUsdrifMintable'
import type { TokenData } from './types'

type Snapshot = Omit<TokenData, 'loading' | 'error' | 'lastUpdated'>

async function queryOptionalMetric(
  provider: ethers.Provider,
  getChecksummedAddress: (address: string) => string,
  address: string,
  abi: readonly string[],
  queryFn: (contract: ethers.Contract) => Promise<bigint>,
  decimals: number = STANDARD_DECIMALS
): Promise<{ raw: bigint; formatted: string } | null> {
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
}

/**
 * Load all dashboard token metrics from chain and persist numeric history.
 */
export async function fetchTokenChainSnapshot(
  provider: ethers.Provider,
  getChecksummedAddress: (address: string) => string
): Promise<Snapshot> {
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
    getChecksummedAddress,
    CONFIG.RIF_PRICE_FEED_RLABS,
    PRICE_FEED_ABI,
    async (contract) => await contract.read(),
    18
  )

  const rifCollateralResult = await queryOptionalMetric(
    provider,
    getChecksummedAddress,
    CONFIG.MOC_V2_CORE,
    MOC_CORE_ABI,
    async (contract) => await contract.getTotalACavailable(),
    STANDARD_DECIMALS
  )

  let maxMintable: bigint | null = null
  let formattedMaxMintable: string | null = null
  let maxMintableOnChain: bigint | null = null
  let formattedMaxMintableOnChain: string | null = null

  try {
    const mocAddress = getChecksummedAddress(CONFIG.MOC_V2_CORE)
    const usdrifAddress = getChecksummedAddress(CONFIG.USDRIF_ADDRESS)
    const moc = new ethers.Contract(mocAddress, MOC_CORE_ABI, provider)

    const [nACcb, ctargemaCA, lckAC, ctargemaTP, pACtp, onChainMintable] = await Promise.all([
      moc.nACcb() as Promise<bigint>,
      moc.getCtargemaCA() as Promise<bigint>,
      moc.getLckAC() as Promise<bigint>,
      moc.getCtargemaTP(usdrifAddress) as Promise<bigint>,
      moc.getPACtp(usdrifAddress) as Promise<bigint>,
      moc.getTPAvailableToMint(usdrifAddress) as Promise<bigint>,
    ])

    const handMintable = calcHandRolledUsdrifMintable(nACcb, ctargemaCA, lckAC, ctargemaTP, pACtp)
    maxMintable = handMintable
    formattedMaxMintable = formatAmountUtil(handMintable, STANDARD_DECIMALS)
    maxMintableOnChain = onChainMintable
    formattedMaxMintableOnChain = formatAmountUtil(onChainMintable, STANDARD_DECIMALS)
  } catch (error) {
    logger.tokenData.warn('Failed to fetch USDRIF mintable metrics:', error)
  }

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

  return {
    stRIFSupply: stRIFSupply != null ? stRIFSupply.toString() : '0',
    formattedStRIFSupply,
    vaultedUsdrif: VUSDSupply != null ? VUSDSupply.toString() : null,
    formattedVaultedUsdrif,
    rifproSupply: rifproSupply != null ? rifproSupply.toString() : '0',
    formattedRifproSupply,
    minted: USDRIFSupply != null ? USDRIFSupply.toString() : null,
    formattedMinted,
    rifPrice: rifPriceResult?.raw != null ? rifPriceResult.raw.toString() : null,
    formattedRifPrice: rifPriceResult?.formatted ?? null,
    rifCollateral: rifCollateralResult?.raw != null ? rifCollateralResult.raw.toString() : null,
    formattedRifCollateral: rifCollateralResult?.formatted ?? null,
    maxMintable: maxMintable != null ? maxMintable.toString() : null,
    formattedMaxMintable,
    maxMintableOnChain: maxMintableOnChain != null ? maxMintableOnChain.toString() : null,
    formattedMaxMintableOnChain,
    symbol: symbol ?? 'USDRIF',
    name: name ?? 'USDRIF',
  }
}