import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://public-node.rsk.co')

const USDRIF_ADDRESS = '0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37'
const MOC_STATE_ADDRESSES = [
  '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257', // Primary MoCState
  '0x541f68a796fe5ae3a381d2aa5a50b975632e40a6', // Legacy mocstateContract
]

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]

const MOC_STATE_ABI = [
  'function absoluteMaxDoc() view returns (uint256)',
  'function absoluteMaxStableToken() view returns (uint256)',
  'function getAbsoluteMaxDoc() view returns (uint256)',
  'function maxDoc() view returns (uint256)',
  'function maxStableToken() view returns (uint256)',
  'function getGlobalCoverage() view returns (uint256)',
  'function availableToMint() view returns (uint256)',
  'function maxMintable() view returns (uint256)',
  'function getMaxMintable() view returns (uint256)',
  'function maxMintableUSDRIF() view returns (uint256)',
]

function formatAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return '0'
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

async function queryAllState() {
  console.log('='.repeat(80))
  console.log('QUERYING ALL CONTRACT STATE VALUES')
  console.log('='.repeat(80))
  console.log('')

  // Query USDRIF token
  console.log('📊 USDRIF TOKEN:', USDRIF_ADDRESS)
  console.log('-'.repeat(80))
  try {
    const usdrif = new ethers.Contract(USDRIF_ADDRESS, ERC20_ABI, provider)
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      usdrif.name(),
      usdrif.symbol(),
      usdrif.decimals(),
      usdrif.totalSupply(),
    ])
    
    const decimalsNum = Number(decimals)
    const formattedSupply = formatAmount(totalSupply, decimalsNum)
    
    console.log(`  name(): "${name}"`)
    console.log(`  symbol(): "${symbol}"`)
    console.log(`  decimals(): ${decimalsNum}`)
    console.log(`  totalSupply(): ${totalSupply.toString()} (${formattedSupply} ${symbol})`)
    console.log('')
  } catch (error: any) {
    console.error(`  ❌ Error querying USDRIF:`, error.message)
    console.log('')
  }

  // Query each MoC State contract
  for (const mocStateAddress of MOC_STATE_ADDRESSES) {
    console.log(`📊 MOC STATE CONTRACT: ${mocStateAddress}`)
    console.log('-'.repeat(80))
    
    try {
      let checksummedAddress: string
      try {
        checksummedAddress = ethers.getAddress(mocStateAddress)
      } catch {
        checksummedAddress = ethers.getAddress(mocStateAddress.toLowerCase())
      }
      
      const mocState = new ethers.Contract(checksummedAddress, MOC_STATE_ABI, provider)
      
      // Query all functions
      const functions = [
        'absoluteMaxDoc',
        'absoluteMaxStableToken',
        'getAbsoluteMaxDoc',
        'maxDoc',
        'maxStableToken',
        'getGlobalCoverage',
        'availableToMint',
        'maxMintable',
        'getMaxMintable',
        'maxMintableUSDRIF',
      ]
      
      for (const fnName of functions) {
        try {
          const result = await mocState[fnName]()
          if (result !== null && result !== undefined) {
            // Try to format as USDRIF decimals (18) first
            try {
              const formatted = formatAmount(result, 18)
              const numValue = parseFloat(formatted)
              console.log(`  ✓ ${fnName}(): ${result.toString()} (${formatted})`)
              if (Math.abs(numValue - 104674) < 1000) {
                console.log(`    ⭐ MATCHES ~104,674!`)
              }
            } catch {
              console.log(`  ✓ ${fnName}(): ${result.toString()}`)
            }
          }
        } catch (error: any) {
          if (error.message?.includes('deprecated')) {
            console.log(`  ⚠ ${fnName}(): Contract deprecated`)
          } else if (!error.message?.includes('execution reverted')) {
            console.log(`  ❌ ${fnName}(): ${error.message}`)
          }
        }
      }
      console.log('')
    } catch (error: any) {
      console.error(`  ❌ Error querying contract ${mocStateAddress}:`, error.message)
      console.log('')
    }
  }

  console.log('='.repeat(80))
  console.log('QUERY COMPLETE')
  console.log('='.repeat(80))
}

queryAllState().catch(console.error)

