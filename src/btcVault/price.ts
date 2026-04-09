import { COINGECKO_BTC_FALLBACK_ID, COINGECKO_PRICE_URL, COINGECKO_RBTC_ID } from './constants'

export function formatBtcVaultUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export async function fetchRbtcUsdPrice(): Promise<number | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(COINGECKO_PRICE_URL, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) return null
    const data = (await res.json()) as { [key: string]: { usd?: number } }
    const rbtc = data[COINGECKO_RBTC_ID]?.usd
    const btc = data[COINGECKO_BTC_FALLBACK_ID]?.usd
    const price = typeof rbtc === 'number' && rbtc > 0 ? rbtc : typeof btc === 'number' && btc > 0 ? btc : null
    return price
  } catch {
    return null
  }
}
