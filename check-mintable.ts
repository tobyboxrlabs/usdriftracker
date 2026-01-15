import { ethers } from 'ethers'

// Contract addresses
const ROOTSTOCK_RPC = process.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co'
const MOC_V2_CORE = '0xA27024Ed70035E46dba712609fc2Afa1c97aA36A'
const RIF_PRICE_FEED_MOC = '0x461750b4824b14c3d9b7702bc6fbb82469082b23'
const USDRIF_ADDRESS = process.env.VITE_USDRIF_ADDRESS || '0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37'

// ABIs
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const

const PRICE_FEED_ABI = [
  'function read() view returns (uint256)',
  'function peek() view returns (bytes32, bool)',
] as const

const MOC_CORE_ABI = [
  'function getTotalACavailable() view returns (uint256)',
  'function getLckAC() view returns (uint256)',
  'function acToken() view returns (address)',
  'function calcCtargemaCA() view returns (uint256)',
  'function getCglb() view returns (uint256)',
] as const

const provider = new ethers.JsonRpcProvider(ROOTSTOCK_RPC)

function formatAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return '0'
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

async function getChecksummedAddress(address: string): Promise<string> {
  try {
    return ethers.getAddress(address)
  } catch {
    return ethers.getAddress(address.toLowerCase())
  }
}

async function queryMetric(
  address: string,
  abi: readonly string[],
  queryFn: (contract: ethers.Contract) => Promise<bigint>,
  decimals: number = 18
): Promise<{ raw: bigint; formatted: string }> {
  const checksummedAddress = await getChecksummedAddress(address)
  const contract = new ethers.Contract(checksummedAddress, abi, provider)
  const raw = await queryFn(contract)
  const formatted = formatAmount(raw, decimals)
  return { raw, formatted }
}

async function calculateMintable() {
  try {
    console.log('🔍 Fetching current on-chain data...\n')

    // Step 1: Total RIF Collateral
    console.log('Step 1: Fetching Total RIF Collateral...')
    const rifCollateralResult = await queryMetric(
      MOC_V2_CORE,
      MOC_CORE_ABI,
      async (contract) => await contract.getTotalACavailable(),
      18
    )
    const totalRifCollateral = parseFloat(rifCollateralResult.formatted)
    console.log(`  ✓ Total RIF Collateral: ${totalRifCollateral.toLocaleString()} RIF\n`)

    // Step 2: Coverage Ratio
    console.log('Step 2: Fetching Coverage Ratio...')
    const targetCoverageResult = await queryMetric(
      MOC_V2_CORE,
      MOC_CORE_ABI,
      async (contract) => await contract.calcCtargemaCA(),
      18
    )
    const coverageRatio = parseFloat(targetCoverageResult.formatted)
    console.log(`  ✓ Coverage Ratio: ${coverageRatio}\n`)

    // Step 3: Ratio'd RIF
    console.log('Step 3: Calculating Ratio\'d RIF...')
    const ratioDRif = totalRifCollateral / coverageRatio
    console.log(`  ✓ Ratio'd RIF: ${ratioDRif.toLocaleString(undefined, { maximumFractionDigits: 2 })} RIF\n`)

    // Step 4: RIF/USD Price (MoC)
    console.log('Step 4: Fetching RIF/USD Price (MoC)...')
    const rifPriceMocResult = await queryMetric(
      RIF_PRICE_FEED_MOC,
      PRICE_FEED_ABI,
      async (contract) => await contract.read(),
      18
    )
    const rifPrice = parseFloat(rifPriceMocResult.formatted)
    console.log(`  ✓ RIF Price: $${rifPrice.toFixed(6)}\n`)

    // Step 5: USD Equivalent of Ratio'd RIF
    console.log('Step 5: Calculating USD Equivalent of Ratio\'d RIF...')
    const usdEquivRatioDRif = ratioDRif * rifPrice
    console.log(`  ✓ USD Equiv Ratio'd RIF: $${usdEquivRatioDRif.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n`)

    // Step 6: Already Minted USDRIF
    console.log('Step 6: Fetching Already Minted USDRIF...')
    const usdrifContract = new ethers.Contract(
      await getChecksummedAddress(USDRIF_ADDRESS),
      ERC20_ABI,
      provider
    )
    const USDRIFSupply = await usdrifContract.totalSupply()
    const USDRIFDecimals = await usdrifContract.decimals()
    const formattedMinted = formatAmount(USDRIFSupply, Number(USDRIFDecimals))
    const mintedUsdrif = parseFloat(formattedMinted)
    console.log(`  ✓ Already Minted USDRIF: $${mintedUsdrif.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n`)

    // Step 7: MINTABLE USDRIF
    console.log('Step 7: Calculating MINTABLE USDRIF...')
    const mintableUsdrif = usdEquivRatioDRif - mintedUsdrif
    
    console.log('\n' + '='.repeat(60))
    console.log('📊 MINTABLE USDRIF CALCULATION RESULT')
    console.log('='.repeat(60))
    console.log(`Total RIF Collateral:     ${totalRifCollateral.toLocaleString()} RIF`)
    console.log(`Coverage Ratio:           ${coverageRatio}`)
    console.log(`Ratio'd RIF:              ${ratioDRif.toLocaleString(undefined, { maximumFractionDigits: 2 })} RIF`)
    console.log(`RIF Price:                $${rifPrice.toFixed(6)}`)
    console.log(`USD Equiv Ratio'd RIF:    $${usdEquivRatioDRif.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    console.log(`Already Minted USDRIF:    $${mintedUsdrif.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    console.log('-'.repeat(60))
    
    if (mintableUsdrif > 0) {
      console.log(`🎯 MINTABLE USDRIF:        $${Math.floor(mintableUsdrif).toLocaleString()}`)
      console.log(`   (${mintableUsdrif.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD)`)
    } else {
      console.log(`⚠️  MINTABLE USDRIF:        $0 (no capacity)`)
    }
    console.log('='.repeat(60))

  } catch (error) {
    console.error('❌ Error calculating mintable USDRIF:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    process.exit(1)
  }
}

calculateMintable()
