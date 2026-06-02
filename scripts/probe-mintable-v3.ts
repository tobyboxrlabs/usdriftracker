/**
 * Phase C.2 — probe USDRIF mintable sources after RoC V2→V3 upgrade.
 *
 * Run:  npx tsx scripts/probe-mintable-v3.ts
 *       npm run probe:mintable-v3
 *
 * References:
 * - Upgrade changer: MultiCollateralUpgradeChanger @ 0x839228759C6640BB486a05c11b6A81166D8A9DC7
 * - Upgrade tx: 0xb59dd3c0400fad040f6ca5adebf64a99c81cd6946840adc1ff345755ef380e8b
 * - Whitepaper: stable-protocol-roc-v2/doc/whitepaper.pdf (multi-collateral, guard §2.4, Mint TP §)
 */

import { ethers } from 'ethers'

const RPC = process.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co'
const DAPP_TARGET = 447_654

/** Checksummed mainnet addresses (from upgrade tx logs + config). */
const ADDR = {
  upgradeChanger: '0x839228759c6640bb486a05c11b6a81166d8a9dc7',
  mocGuardProxy: '0x0237ad1f0831b479a344e56646bc48b0885cf46f',
  mocGuardImpl: '0xc36da47c94c57fde23cef9fc436b4eda9a7c3ebd',
  rifBucketProxy: '0xa27024ed70035e46dba712609fc2afa1c97aa36a',
  rifBucketImpl: '0x1a2702d60a8b68b845709155b3d97e1da85fec54',
  docBucketProxy: '0x697535055aa7afd2c280523c7b062b1f05284661',
  docBucketImpl: '0xf9208ca168ff7ccafd120edbf39cf86b625f5a9b',
  usdrifProxy: '0x3a15461d8ae0f0fb5fa2629e9da7d66a794a6e37',
  usdrifImpl: '0x6d1bb87856a2b2351d87ba5772a93dc911325af9',
  rifPriceFeedMoc: '0x461750b4824b14c3d9b7702bc6fbb82469082b23',
  rifAcToken: '0x9f5ce0a8f023f8096145ce2d792eb66091cb89fe',
  docAcToken: '0x6ca9d0e9382f58ac9b109f5f7f3aabc8b86c1a24',
  usdrifPriceProvider: '0x6a5b2c84e63b5c1330bf4cccff1ad6f23116cc14',
} as const

const GUARD_ABI = [
  'function getRealTPAvailableToMint(address bucket, address tpToken) view returns (uint256)',
  'function getRealTCAvailableToRedeem(address bucket) view returns (uint256)',
  'function getBucketAmount() view returns (uint256)',
  'function bucketIndex(address bucket) view returns (uint256)',
  'function buckets(uint256 index) view returns (address)',
] as const

const MOC_RIF_ABI = [
  'function getTPAvailableToMint(address tpToken) view returns (uint256)',
  'function getTCAvailableToRedeem() view returns (uint256)',
  'function getTotalACavailable() view returns (uint256)',
  'function getCtargemaCA() view returns (uint256)',
  'function getCtargemaTP(address tpToken) view returns (uint256)',
  'function getNTP(address tpToken) view returns (uint256)',
  'function getPACtp(address tpToken) view returns (uint256)',
  'function calcCtargemaCA(uint256[] prices) view returns (uint256)',
  'function calcCtargemaTP(address tpToken, uint256[] prices) view returns (uint256)',
  'function calcTPAvailableToMint(address tpToken, uint256[] prices) view returns (uint256)',
] as const

const ERC20_ABI = ['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)'] as const
const PRICE_ABI = ['function read() view returns (uint256)'] as const
const AC_ABI = ['function balanceOf(address) view returns (uint256)'] as const

type ProbeResult = {
  label: string
  ok: boolean
  human?: string
  raw?: string
  note?: string
}

function cs(addr: string): string {
  return ethers.getAddress(addr.toLowerCase())
}

function fmt18(value: bigint): string {
  const n = Number(ethers.formatUnits(value, 18))
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function pctDelta(actual: number, target: number): string {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target === 0) return 'n/a'
  const d = ((actual - target) / target) * 100
  return `${d >= 0 ? '+' : ''}${d.toFixed(2)}% vs dApp`
}

async function probeCall<T extends bigint>(
  label: string,
  fn: () => Promise<T>,
  note?: string
): Promise<ProbeResult> {
  try {
    const raw = await fn()
    const human = fmt18(raw)
    return { label, ok: true, human, raw: raw.toString(), note }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { label, ok: false, note: msg.slice(0, 120) }
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC)
  const block = await provider.getBlockNumber()

  const guard = new ethers.Contract(cs(ADDR.mocGuardProxy), GUARD_ABI, provider)
  const rif = new ethers.Contract(cs(ADDR.rifBucketProxy), MOC_RIF_ABI, provider)
  const usdrif = new ethers.Contract(cs(ADDR.usdrifProxy), ERC20_ABI, provider)
  const rifAc = new ethers.Contract(cs(ADDR.rifAcToken), AC_ABI, provider)
  const price = new ethers.Contract(cs(ADDR.rifPriceFeedMoc), PRICE_ABI, provider)

  const tp = cs(ADDR.usdrifProxy)
  const rifBucket = cs(ADDR.rifBucketProxy)
  const docBucket = cs(ADDR.docBucketProxy)

  console.log('═'.repeat(72))
  console.log('USDRIF Mintable V3 probe')
  console.log('═'.repeat(72))
  console.log(`RPC: ${RPC}`)
  console.log(`Block: ${block}`)
  console.log(`dApp reference (USDRIF mintable): ~${DAPP_TARGET.toLocaleString()}`)
  console.log()

  console.log('── Upgrade topology (tx 0xb59d…80e8b) ──')
  console.log(`  Changer: MultiCollateralUpgradeChanger @ ${ADDR.upgradeChanger}`)
  console.log(`  MocRif proxy ${ADDR.rifBucketProxy} → impl MocRif ${ADDR.rifBucketImpl}`)
  console.log(`  USDRIF proxy ${ADDR.usdrifProxy} → impl StableTokenV2 ${ADDR.usdrifImpl}`)
  console.log(`  Guard proxy ${ADDR.mocGuardProxy} → impl MocMultiCollateralGuard ${ADDR.mocGuardImpl}`)
  console.log(`  DOC bucket ${ADDR.docBucketProxy} (index 1); RIF bucket index 0`)
  console.log(`  RIF AC token ${ADDR.rifAcToken}; USDRIF price provider ${ADDR.usdrifPriceProvider}`)
  console.log()

  const results: ProbeResult[] = []

  results.push(
    await probeCall('★ MocRif.getTPAvailableToMint(USDRIF)', () => rif.getTPAvailableToMint(tp), 'Preferred Phase C read (RIF bucket proxy)')
  )
  results.push(
    await probeCall('Guard.getRealTPAvailableToMint(RIF bucket, USDRIF)', () =>
      guard.getRealTPAvailableToMint(rifBucket, tp)
    )
  )
  results.push(
    await probeCall('Guard.getRealTPAvailableToMint(DOC bucket, USDRIF)', () =>
      guard.getRealTPAvailableToMint(docBucket, tp),
      'DOC bucket — not for RIF-row dApp mintable'
    )
  )

  // Phase B legacy formula
  const [collateral, coverage, rifPrice, supply] = await Promise.all([
    rif.getTotalACavailable(),
    rif.getCtargemaCA(),
    price.read(),
    usdrif.totalSupply(),
  ])
  const rifBagProbe = await probeCall('RIF AC balanceOf(RIF bucket)', () => rifAc.balanceOf(rifBucket))
  const rifBagBalance = rifBagProbe.ok && rifBagProbe.raw ? BigInt(rifBagProbe.raw) : null
  const legacyMintable = (collateral * rifPrice) / coverage > supply
    ? (collateral * rifPrice) / coverage - supply
    : 0n
  results.push({
    label: 'Phase B formula: (getTotalACavailable × price) / getCtargemaCA − supply',
    ok: true,
    human: fmt18(legacyMintable),
    raw: legacyMintable.toString(),
    note: 'Under-shoots dApp; ignores guard / joint-bucket math',
  })

  results.push(
    await probeCall('MocRif.getNTP(USDRIF) [minted in bucket]', () => rif.getNTP(tp))
  )
  results.push(
    await probeCall('USDRIF.totalSupply() [global ERC20]', () => usdrif.totalSupply())
  )
  if (rifBagProbe.ok) results.push({ ...rifBagProbe, label: 'RIF AC balanceOf(RIF bucket) [collateral bag]' })
  results.push(
    await probeCall('MocRif.getTotalACavailable()', () => rif.getTotalACavailable())
  )
  results.push(
    await probeCall('MocRif.getCtargemaCA() [target coverage adj.]', () => rif.getCtargemaCA())
  )
  results.push(
    await probeCall('MocRif.getCtargemaTP(USDRIF) [per-TP target coverage]', () => rif.getCtargemaTP(tp))
  )

  // calcCtargemaCA reverted post-V3
  results.push(
    await probeCall('MocRif.calcCtargemaCA([]) [legacy — expect revert]', () => rif.calcCtargemaCA([]))
  )

  console.log('── Mintable candidates ──')
  for (const r of results) {
    const status = r.ok ? 'OK ' : 'FAIL'
    const line = r.human != null ? `${r.human} (${r.raw})` : r.note ?? ''
    const delta =
      r.ok && r.human && r.label.includes('getTPAvailableToMint')
        ? `  ${pctDelta(Number(r.human.replace(/,/g, '')), DAPP_TARGET)}`
        : r.ok && r.human && r.label.startsWith('Phase B')
          ? `  ${pctDelta(Number(r.human.replace(/,/g, '')), DAPP_TARGET)}`
          : ''
    console.log(`  [${status}] ${r.label}`)
    console.log(`         ${line}${delta}`)
    if (r.note && r.ok) console.log(`         ↳ ${r.note}`)
  }

  console.log()
  console.log('── Context metrics (dApp screenshot cross-check) ──')
  console.log(`  getTotalACavailable:     ${fmt18(collateral)}`)
  console.log(`  RIF bag balance:         ${rifBagBalance != null ? fmt18(rifBagBalance) : rifBagProbe.note ?? 'n/a'}`)
  console.log(`  getCtargemaCA:           ${Number(ethers.formatUnits(coverage, 18)).toFixed(4)}`)
  console.log(`  MoC RIF price read():    ${Number(ethers.formatUnits(rifPrice, 18)).toFixed(6)}`)
  console.log(`  USDRIF totalSupply:      ${fmt18(supply)}`)
  console.log()

  const winner = results.find((r) => r.label.startsWith('★') && r.ok)
  console.log('── Recommendation ──')
  if (winner?.human) {
    console.log(`  Use ${winner.label.replace('★ ', '')} on ${ADDR.rifBucketProxy}`)
    console.log(`  Matches rifonchain dApp mintable within normal block/price drift.`)
  } else {
    console.log('  No winning candidate; inspect FAIL lines above.')
  }
  console.log('  Whitepaper: multi-collateral guard (§2.4) coordinates buckets; Mint TP uses guard math.')
  console.log('  Do not use DOC bucket getRealTP for RIF/USDRIF row mintable.')
  console.log('═'.repeat(72))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
