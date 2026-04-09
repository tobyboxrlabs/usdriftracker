/** ~30s RSK block time × 86400 / 30 */
export const BLOCKS_PER_DAY = 2880

export const COINGECKO_RBTC_ID = 'rootstock-smart-bitcoin'
export const COINGECKO_BTC_FALLBACK_ID = 'bitcoin'
export const COINGECKO_PRICE_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_RBTC_ID},${COINGECKO_BTC_FALLBACK_ID}&vs_currencies=usd`
