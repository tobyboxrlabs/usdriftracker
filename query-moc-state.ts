import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://public-node.rsk.co')

const MOC_STATE_ADDRESSES = [
  '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257', // Primary MoCState
  '0x541f68a796fe5ae3a381d2aa5a50b975632e40a6', // Legacy mocstateContract
  '0xb8a6beba78c3e73f6a66ddacfaeb240ae22ca709', // MoC Settlement
]

const USDRIF_ADDRESS = '0x5db91e24BD32059584bbDb831A901f1199f3d459'

// Comprehensive MoC State ABI with all possible functions
const MOC_STATE_ABI = [
  // Max supply functions
  'function absoluteMaxDoc() view returns (uint256)',
  'function absoluteMaxStableToken() view returns (uint256)',
  'function getAbsoluteMaxDoc() view returns (uint256)',
  'function maxDoc() view returns (uint256)',
  'function maxStableToken() view returns (uint256)',
  
  // Minting functions
  'function availableToMint() view returns (uint256)',
  'function availableToMint(address) view returns (uint256)',
  'function maxMintable() view returns (uint256)',
  'function getMaxMintable() view returns (uint256)',
  'function maxMintableUSDRIF() view returns (uint256)',
  
  // Minted functions
  'function minted() view returns (uint256)',
  'function getMinted() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  
  // Coverage functions
  'function getGlobalCoverage() view returns (uint256)',
  'function globalCoverage() view returns (uint256)',
  
  // Other state functions
  'function bproTotalSupply() view returns (uint256)',
  'function btcxTotalSupply() view returns (uint256)',
  'function docTotalSupply() view returns (uint256)',
  'function getInrateBag() view returns (uint256)',
  'function getLiquidationPrice() view returns (uint256)',
  'function getBitcoinPrice() view returns (uint256)',
] as const

function formatAmount(amount: bigint, decimals: number = 18): string {
  if (amount === 0n) return '0'
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

async function queryAllMoCState() {
  console.log('='.repeat(80))
  console.log('QUERYING ALL MOC STATE CONTRACT FUNCTIONS')
  console.log('='.repeat(80))
  console.log('')

  const USDRIF_CHECKSUMMED = ethers.getAddress(USDRIF_ADDRESS.toLowerCase())

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
      for (const fnSig of MOC_STATE_ABI) {
        const fnName = fnSig.split('(')[0].replace('function ', '')
        const hasAddressParam = fnSig.includes('address)')
        
        try {
          let result: bigint
          if (hasAddressParam) {
            result = await mocState[fnName](USDRIF_CHECKSUMMED)
          } else {
            result = await mocState[fnName]()
          }
          
          if (result !== null && result !== undefined) {
            const formatted = formatAmount(result, 18)
            const numValue = parseFloat(formatted)
            console.log(`  ✓ ${fnSig}`)
            console.log(`    Value: ${result.toString()}`)
            console.log(`    Formatted: ${numValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`)
            console.log('')
          }
        } catch (error: any) {
          if (!error.message?.includes('execution reverted') && !error.message?.includes('deprecated')) {
            // Only log non-revert errors
          }
        }
      }
    } catch (error: any) {
      console.error(`  ❌ Error querying contract ${mocStateAddress}:`, error.message)
      console.log('')
    }
  }

  console.log('='.repeat(80))
  console.log('QUERY COMPLETE')
  console.log('='.repeat(80))
}

queryAllMoCState().catch(console.error)

