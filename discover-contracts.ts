import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://public-node.rsk.co')

// All known contracts
const CONTRACTS = [
  {
    name: 'USDRIF Token',
    address: '0x5db91e24BD32059584bbDb831A901f1199f3d459',
    type: 'ERC20',
  },
  {
    name: 'RIFPRO Token',
    address: '0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61',
    type: 'ERC20',
  },
  {
    name: 'MoC State (Primary)',
    address: '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257',
    type: 'MoCState',
  },
  {
    name: 'MoC State (Legacy)',
    address: '0x541f68a796fe5ae3a381d2aa5a50b975632e40a6',
    type: 'MoCState',
  },
  {
    name: 'MoC Settlement',
    address: '0xb8a6beba78c3e73f6a66ddacfaeb240ae22ca709',
    type: 'MoCSettlement',
  },
  {
    name: 'MoC Settlement (Alt)',
    address: '0xe3abce2b0ee0d7ea48a5bcd0442d5505ae5b6334',
    type: 'MoCSettlement',
  },
  {
    name: 'USDRIF Fee Collector',
    address: '0x4905f643db489d9561617638d31875b6bff79077',
    type: 'Unknown',
  },
  {
    name: 'Protocol Revenue Distributor',
    address: '0xf7fdf7F777C43Cd31c4c37Ee851F08A51abD2dB5',
    type: 'Unknown',
  },
  {
    name: 'RIF Price Feed (MoC)',
    address: '0x461750b4824b14c3d9b7702bc6fbb82469082b23',
    type: 'PriceFeed',
  },
  {
    name: 'RIF Price Feed (RLabs)',
    address: '0xbed51d83cc4676660e3fc3819dfad8238549b975',
    type: 'PriceFeed',
  },
]

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]

const MOC_STATE_ABI = [
  // Max supply
  'function absoluteMaxDoc() view returns (uint256)',
  'function absoluteMaxStableToken() view returns (uint256)',
  'function getAbsoluteMaxDoc() view returns (uint256)',
  'function maxDoc() view returns (uint256)',
  'function maxStableToken() view returns (uint256)',
  
  // Minting
  'function availableToMint() view returns (uint256)',
  'function availableToMint(address) view returns (uint256)',
  'function maxMintable() view returns (uint256)',
  'function getMaxMintable() view returns (uint256)',
  'function maxMintableUSDRIF() view returns (uint256)',
  
  // Minted
  'function minted() view returns (uint256)',
  'function minted(address) view returns (uint256)',
  'function getMinted() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  
  // Coverage
  'function getGlobalCoverage() view returns (uint256)',
  'function globalCoverage() view returns (uint256)',
  
  // Other state
  'function bproTotalSupply() view returns (uint256)',
  'function btcxTotalSupply() view returns (uint256)',
  'function docTotalSupply() view returns (uint256)',
  'function getInrateBag() view returns (uint256)',
  'function getLiquidationPrice() view returns (uint256)',
  'function getBitcoinPrice() view returns (uint256)',
]

const SETTLEMENT_ABI = [
  'function availableToMint() view returns (uint256)',
  'function availableToMint(address) view returns (uint256)',
  'function minted() view returns (uint256)',
  'function minted(address) view returns (uint256)',
]

const PRICE_FEED_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function latestAnswer() view returns (int256)',
  'function latestTimestamp() view returns (uint256)',
]

function formatAmount(amount: bigint, decimals: number = 18): string {
  if (amount === 0n) return '0'
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

interface Result {
  contract: string
  address: string
  function: string
  signature: string
  value: string
  formatted: string
  success: boolean
}

async function queryContract(contract: typeof CONTRACTS[0], abi: readonly string[], results: Result[]) {
  const USDRIF = ethers.getAddress('0x5db91e24BD32059584bbDb831A901f1199f3d459'.toLowerCase())
  
  try {
    let checksummedAddress: string
    try {
      checksummedAddress = ethers.getAddress(contract.address)
    } catch {
      checksummedAddress = ethers.getAddress(contract.address.toLowerCase())
    }
    
    const contractInstance = new ethers.Contract(checksummedAddress, abi, provider)
    
    for (const fnSig of abi) {
      const fnName = fnSig.split('(')[0].replace('function ', '')
      const hasAddressParam = fnSig.includes('address)')
      
      try {
        let result: any
        if (hasAddressParam) {
          result = await contractInstance[fnName](USDRIF)
        } else {
          result = await contractInstance[fnName]()
        }
        
        if (result !== null && result !== undefined) {
          // Handle tuple returns (like latestRoundData)
          if (Array.isArray(result)) {
            const formatted = result.map((r: any) => {
              if (typeof r === 'bigint') {
                return formatAmount(r, 18)
              }
              return r.toString()
            }).join(', ')
            results.push({
              contract: contract.name,
              address: contract.address,
              function: fnName,
              signature: fnSig,
              value: result.toString(),
              formatted: formatted,
              success: true,
            })
          } else if (typeof result === 'bigint') {
            const formatted = formatAmount(result, 18)
            results.push({
              contract: contract.name,
              address: contract.address,
              function: fnName,
              signature: fnSig,
              value: result.toString(),
              formatted: formatted,
              success: true,
            })
          } else {
            results.push({
              contract: contract.name,
              address: contract.address,
              function: fnName,
              signature: fnSig,
              value: result.toString(),
              formatted: result.toString(),
              success: true,
            })
          }
        }
      } catch (error: any) {
        // Only log if it's not a revert
        if (!error.message?.includes('execution reverted') && !error.message?.includes('deprecated')) {
          results.push({
            contract: contract.name,
            address: contract.address,
            function: fnName,
            signature: fnSig,
            value: '',
            formatted: '',
            success: false,
          })
        }
      }
    }
  } catch (error: any) {
    console.error(`Error querying ${contract.name}:`, error.message)
  }
}

async function discover() {
  console.log('='.repeat(100))
  console.log('CONTRACT DISCOVERY - RIF ON CHAIN & USDRIF')
  console.log('='.repeat(100))
  console.log('')
  
  const results: Result[] = []
  
  // Query ERC20 contracts
  for (const contract of CONTRACTS.filter(c => c.type === 'ERC20')) {
    await queryContract(contract, ERC20_ABI, results)
  }
  
  // Query MoC State contracts
  for (const contract of CONTRACTS.filter(c => c.type === 'MoCState')) {
    await queryContract(contract, MOC_STATE_ABI, results)
  }
  
  // Query Settlement contracts
  for (const contract of CONTRACTS.filter(c => c.type === 'MoCSettlement')) {
    await queryContract(contract, SETTLEMENT_ABI, results)
  }
  
  // Query Price Feed contracts
  for (const contract of CONTRACTS.filter(c => c.type === 'PriceFeed')) {
    await queryContract(contract, PRICE_FEED_ABI, results)
  }
  
  // Print summary table
  console.log('SUMMARY TABLE')
  console.log('='.repeat(100))
  console.log('')
  
  // Group by contract
  const byContract = new Map<string, Result[]>()
  for (const result of results) {
    if (!byContract.has(result.contract)) {
      byContract.set(result.contract, [])
    }
    byContract.get(result.contract)!.push(result)
  }
  
  for (const [contractName, contractResults] of byContract.entries()) {
    console.log(`\n${contractName} (${contractResults[0]?.address})`)
    console.log('-'.repeat(100))
    
    if (contractResults.length === 0) {
      console.log('  No successful queries')
      continue
    }
    
    // Print table header
    console.log('Function'.padEnd(30) + 'Value'.padEnd(30) + 'Formatted')
    console.log('-'.repeat(100))
    
    for (const result of contractResults) {
      if (result.success) {
        const fnName = result.function.padEnd(30)
        const value = result.value.substring(0, 29).padEnd(30)
        const formatted = result.formatted.substring(0, 39)
        console.log(`${fnName}${value}${formatted}`)
      }
    }
  }
  
  // Look for specific values
  console.log('\n' + '='.repeat(100))
  console.log('TARGET VALUES')
  console.log('='.repeat(100))
  console.log('')
  
  // USDRIF Total Supply (~26m)
  console.log('USDRIF Total Supply (~26m):')
  const usdrifSupply = results.find(r => r.contract === 'USDRIF Token' && r.function === 'totalSupply')
  if (usdrifSupply && usdrifSupply.success) {
    console.log(`  ✓ Found: ${usdrifSupply.formatted}`)
  } else {
    console.log('  ✗ Not found')
  }
  
  // USDRIF Minted (~1.5m)
  console.log('\nUSDRIF Minted (~1.5m):')
  const mintedResults = results.filter(r => 
    r.function.includes('minted') && r.success
  )
  for (const r of mintedResults) {
    const val = parseFloat(r.formatted)
    if (val > 1400000 && val < 1600000) {
      console.log(`  ⭐ ${r.contract}.${r.function}: ${r.formatted}`)
    }
  }
  if (mintedResults.length === 0) {
    console.log('  ✗ Not found')
  }
  
  // USDRIF Mintable (~99.9k)
  console.log('\nUSDRIF Mintable (~99.9k):')
  const mintableResults = results.filter(r => 
    (r.function.includes('availableToMint') || r.function.includes('maxMintable')) && r.success
  )
  for (const r of mintableResults) {
    const val = parseFloat(r.formatted)
    if (val > 95000 && val < 110000) {
      console.log(`  ⭐ ${r.contract}.${r.function}: ${r.formatted}`)
    }
  }
  if (mintableResults.length === 0) {
    console.log('  ✗ Not found')
  }
  
  console.log('\n' + '='.repeat(100))
  console.log('DISCOVERY COMPLETE')
  console.log('='.repeat(100))
}

discover().catch(console.error)

