/**
 * Phase C exploration — can a hand-rolled formula match getTPAvailableToMint?
 *
 * Source (MocCore / MocBaseBucket on MocRif proxy, Blockscout verified):
 *   lckACemaAdjusted = totalACavailable * PRECISION - ctargemaCA * lckAC
 *                    = nACcb * 1e18 - getCtargemaCA() * getLckAC()   (when nACgain ≈ 0)
 *   tpAvailableToMint = (lckACemaAdjusted * pACtp) / ((ctargemaTP - ONE) * PRECISION)
 *
 * NOT (collateral * rifUsdPrice / coverage - totalSupply) — Phase B uses the wrong model.
 *
 * Run: npm run probe:mintable-formula
 */

import { ethers } from 'ethers'

const RPC = process.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co'
const RIF_BUCKET = ethers.getAddress('0xa27024ed70035e46dba712609fc2afa1c97aa36a')
const GUARD = ethers.getAddress('0x0237ad1f0831b479a344e56646bc48b0885cf46f')
const USDRIF = ethers.getAddress('0x3a15461d8ae0f0fb5fa2629e9da7d66a794a6e37')
const RIF_PRICE_FEED = ethers.getAddress('0x461750b4824b14c3d9b7702bc6fbb82469082b23')

const ONE = 10n ** 18n
const PRECISION = ONE

const BUCKET_ABI = [
  'function getTPAvailableToMint(address tp) view returns (uint256)',
  'function getCtargemaCA() view returns (uint256)',
  'function getCtargemaTP(address tp) view returns (uint256)',
  'function getPACtp(address tp) view returns (uint256)',
  'function getLckAC() view returns (uint256)',
  'function getTotalACavailable() view returns (uint256)',
  'function nACcb() view returns (uint256)',
  'function getNTP(address tp) view returns (uint256)',
  'function calcLckACemaAdjusted(uint256[] prices) view returns (int256)',
  'function calcCtargemaTP(address tp, uint256 pACtp) view returns (uint256)',
  'function calcTPAvailableToMint(address tp, uint256[] prices) view returns (uint256)',
] as const

const GUARD_ABI = ['function getBucketsPACtps() view returns (uint256[][])'] as const
const PRICE_ABI = ['function read() view returns (uint256)'] as const
const ERC20_ABI = ['function totalSupply() view returns (uint256)'] as const

function fmt18(v: bigint): string {
  return Number(ethers.formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** Protocol mintable from bucket view getters (no price array). */
function handRolledFromGetters(
  nACcb: bigint,
  ctargemaCA: bigint,
  lckAC: bigint,
  ctargemaTP: bigint,
  pACtp: bigint
): bigint {
  const lckACemaAdjusted = nACcb * PRECISION - ctargemaCA * lckAC
  if (lckACemaAdjusted <= 0n) return 0n
  const denom = (ctargemaTP - ONE) * PRECISION
  if (denom <= 0n) return 0n
  const signed = (lckACemaAdjusted * pACtp) / denom
  return signed < 0n ? 0n : signed
}

/** Phase B formula used in fetchTokenChainSnapshot before V3 fix. */
function phaseBFormula(
  totalAC: bigint,
  rifPrice: bigint,
  ctargemaCA: bigint,
  usdrifSupply: bigint
): bigint {
  const cap = (totalAC * rifPrice) / ctargemaCA
  return cap > usdrifSupply ? cap - usdrifSupply : 0n
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC)
  const rif = new ethers.Contract(RIF_BUCKET, BUCKET_ABI, provider)
  const guard = new ethers.Contract(GUARD, GUARD_ABI, provider)
  const feed = new ethers.Contract(RIF_PRICE_FEED, PRICE_ABI, provider)
  const usdrif = new ethers.Contract(USDRIF, ERC20_ABI, provider)

  const [
    truth,
    ctargemaCA,
    ctargemaTP,
    pACtp,
    lckAC,
    totalAC,
    nACcb,
    nTP,
    supply,
    rifPrice,
    bucketsPACtps,
  ] = await Promise.all([
    rif.getTPAvailableToMint(USDRIF),
    rif.getCtargemaCA(),
    rif.getCtargemaTP(USDRIF),
    rif.getPACtp(USDRIF),
    rif.getLckAC(),
    rif.getTotalACavailable(),
    rif.nACcb(),
    rif.getNTP(USDRIF),
    usdrif.totalSupply(),
    feed.read(),
    guard.getBucketsPACtps(),
  ])

  const rifPrices = [...bucketsPACtps[0].map((x: bigint) => BigInt(x))]
  const calcViaPrices = await rif.calcTPAvailableToMint(USDRIF, rifPrices)
  const lckAdjSigned: bigint = await rif.calcLckACemaAdjusted(rifPrices)
  const ctargTPcalc: bigint = await rif.calcCtargemaTP(USDRIF, rifPrices[0])

  const handGetters = handRolledFromGetters(nACcb, ctargemaCA, lckAC, ctargemaTP, pACtp)
  const handFromCalcAdj =
    lckAdjSigned <= 0n
      ? 0n
      : (lckAdjSigned * rifPrices[0]) / ((ctargTPcalc - ONE) * PRECISION)
  const phaseB = phaseBFormula(totalAC, rifPrice, ctargemaCA, supply)

  const rows: { label: string; value: bigint }[] = [
    { label: '★ getTPAvailableToMint (canonical)', value: truth },
    { label: 'Hand-rolled from getters (protocol formula)', value: handGetters },
    { label: 'Hand-rolled from calcLckACemaAdjusted + calcCtargemaTP', value: handFromCalcAdj < 0n ? 0n : handFromCalcAdj },
    { label: 'calcTPAvailableToMint(guard prices)', value: calcViaPrices },
    { label: 'Phase B: (totalAC × MoC RIF feed) / ctargemaCA − supply', value: phaseB },
  ]

  console.log('═'.repeat(72))
  console.log('Mintable formula comparison (RIF bucket / USDRIF)')
  console.log('═'.repeat(72))
  console.log(`Block: ${await provider.getBlockNumber()}\n`)

  const truthN = Number(ethers.formatUnits(truth, 18))
  for (const { label, value } of rows) {
    const n = Number(ethers.formatUnits(value, 18))
    const err = truthN
      ? `${(((n - truthN) / truthN) * 100).toFixed(2)}% vs canonical`
      : ''
    console.log(`  ${label}`)
    console.log(`    → ${fmt18(value)}  ${err}`)
  }

  console.log('\n── Inputs (why Phase B diverges) ──')
  console.log(`  nACcb (collateral bag):     ${fmt18(nACcb)}`)
  console.log(`  getTotalACavailable():      ${fmt18(totalAC)}  (= nACcb − nACgain; nACgain often ~0)`)
  console.log(`  getLckAC():                 ${fmt18(lckAC)}  (locked AC for pegged tokens, not “free” collateral)`)
  console.log(`  getCtargemaCA():            ${Number(ethers.formatUnits(ctargemaCA, 18)).toFixed(4)}`)
  console.log(`  getCtargemaTP(USDRIF):      ${Number(ethers.formatUnits(ctargemaTP, 18)).toFixed(4)}  (per-TP target; UI “T. Coverage” ~5.5 is tpCtarg, not this)`)
  console.log(`  getPACtp(USDRIF):           ${Number(ethers.formatUnits(pACtp, 18)).toFixed(6)}  (RIF priced in USDRIF units, not MoC feed alone)`)
  console.log(`  MoC RIF feed read():        ${Number(ethers.formatUnits(rifPrice, 18)).toFixed(6)}`)
  console.log(`  getNTP(USDRIF):             ${fmt18(nTP)}`)
  console.log(`  USDRIF.totalSupply():       ${fmt18(supply)}`)
  console.log(`  lckACemaAdjusted:           nACcb×1e18 − ctargemaCA×lckAC`)

  console.log('\n── Conclusion ──')
  const match =
    handGetters === truth
      ? 'YES — enhanced hand-roll matches getTPAvailableToMint exactly.'
      : 'NO — drift; prefer getTPAvailableToMint.'
  console.log(`  ${match}`)
  console.log('  Phase B error: uses totalAC × external price / covCA minus supply; protocol uses')
  console.log('  lckACemaAdjusted × pACtp / (ctargemaTP − 1) with no “minus minted” term.')
  console.log('  Multi-collateral guard min() already applied inside getTPAvailableToMint on bucket.')
  console.log('═'.repeat(72))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
