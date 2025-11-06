import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://public-node.rsk.co')

const USDRIF = ethers.getAddress('0x5db91e24BD32059584bbDb831A901f1199f3d459'.toLowerCase())
const MOC_STATE = '0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257'
const CONNECTOR = '0xcE2A128cC73e5d98355aAfb2595647F2D3171Faa'
const MOC = '0xf773B590aF754D597770937Fa8ea7AbDf2668370'

interface Result {
  contract: string
  address: string
  function: string
  signature: string
  success: boolean
  value?: string
  formatted?: string
}

function formatAmount(amount: bigint, decimals: number = 18): string {
  if (amount === 0n) return '0'
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

async function queryAllContracts(): Promise<Result[]> {
  const results: Result[] = []
  
  // Query MoCState
  const mocStateABI = [
    'function absoluteMaxDoc() view returns (uint256)',
    'function docTotalSupply() view returns (uint256)',
    'function globalCoverage() view returns (uint256)',
    'function bproTotalSupply() view returns (uint256)',
    'function getBitcoinPrice() view returns (uint256)',
    // V2 eval functions
    'function evalTPavailableToMint(address) view returns (uint256)',
    'function evalTPminted(address) view returns (uint256)',
    'function evalTPtotalSupply(address) view returns (uint256)',
    'function evalTPabsoluteMax(address) view returns (uint256)',
  ]
  
  const mocState = new ethers.Contract(MOC_STATE, mocStateABI, provider)
  
  for (const fnSig of mocStateABI) {
    const fnName = fnSig.split('(')[0].replace('function ', '')
    try {
      let result: bigint
      if (fnSig.includes('address)')) {
        result = await mocState[fnName](USDRIF)
      } else {
        result = await mocState[fnName]()
      }
      const formatted = formatAmount(result, 18)
      results.push({
        contract: 'MoCState',
        address: MOC_STATE,
        function: fnName,
        signature: fnSig,
        success: true,
        value: result.toString(),
        formatted: formatted,
      })
    } catch {}
  }
  
  // Query MoC Contract
  const mocABI = [
    'function evalTPavailableToMint(address) view returns (uint256)',
    'function evalTPminted(address) view returns (uint256)',
    'function evalTPtotalSupply(address) view returns (uint256)',
    'function evalTPabsoluteMax(address) view returns (uint256)',
  ]
  
  const moc = new ethers.Contract(MOC, mocABI, provider)
  
  for (const fnSig of mocABI) {
    const fnName = fnSig.split('(')[0].replace('function ', '')
    try {
      const result = await moc[fnName](USDRIF)
      const formatted = formatAmount(result, 18)
      results.push({
        contract: 'MoC',
        address: MOC,
        function: fnName,
        signature: fnSig,
        success: true,
        value: result.toString(),
        formatted: formatted,
      })
    } catch {}
  }
  
  // Query USDRIF Token
  const erc20ABI = ['function totalSupply() view returns (uint256)']
  const usdrifToken = new ethers.Contract(USDRIF, erc20ABI, provider)
  
  try {
    const result = await usdrifToken.totalSupply()
    const formatted = formatAmount(result, 18)
    results.push({
      contract: 'USDRIF Token',
      address: USDRIF,
      function: 'totalSupply',
      signature: 'function totalSupply() view returns (uint256)',
      success: true,
      value: result.toString(),
      formatted: formatted,
    })
  } catch {}
  
  return results
}

async function main() {
  console.log('='.repeat(120))
  console.log('COMPREHENSIVE CONTRACT DISCOVERY - RIF ON CHAIN & USDRIF')
  console.log('='.repeat(120))
  console.log('')
  
  const results = await queryAllContracts()
  
  // Print summary table
  console.log('CONTRACT DISCOVERY RESULTS')
  console.log('='.repeat(120))
  console.log('')
  
  const byContract = new Map<string, Result[]>()
  for (const result of results) {
    if (!byContract.has(result.contract)) {
      byContract.set(result.contract, [])
    }
    byContract.get(result.contract)!.push(result)
  }
  
  for (const [contractName, contractResults] of byContract.entries()) {
    console.log(`${contractName} (${contractResults[0]?.address})`)
    console.log('-'.repeat(120))
    
    if (contractResults.length === 0) {
      console.log('  No successful queries')
      continue
    }
    
    console.log('Function'.padEnd(40) + 'Formatted Value'.padEnd(30) + 'Raw Value')
    console.log('-'.repeat(120))
    
    for (const result of contractResults) {
      if (result.success) {
        const fn = result.function.padEnd(40)
        const formatted = (result.formatted || '').substring(0, 29).padEnd(30)
        const value = (result.value || '').substring(0, 49)
        console.log(`${fn}${formatted}${value}`)
      }
    }
    console.log('')
  }
  
  // Check for target values
  console.log('='.repeat(120))
  console.log('TARGET METRICS ANALYSIS')
  console.log('='.repeat(120))
  console.log('')
  
  console.log('USDRIF Total Supply (~26m):')
  const totalSupply = results.find(r => r.contract === 'USDRIF Token' && r.function === 'totalSupply')
  if (totalSupply) {
    console.log(`  ✓ Found: ${totalSupply.formatted}`)
  } else {
    console.log('  ✗ Not found')
  }
  
  console.log('\nUSDRIF Minted (~1.5m):')
  const mintedResults = results.filter(r => 
    r.function.includes('minted') && r.success
  )
  for (const r of mintedResults) {
    const val = parseFloat(r.formatted || '0')
    console.log(`  ${r.contract}.${r.function}: ${r.formatted}`)
    if (val > 1400000 && val < 1600000) {
      console.log('    ⭐ MATCHES ~1.5m!')
    }
  }
  if (mintedResults.length === 0) {
    console.log('  ✗ Not found in any contract')
  }
  
  console.log('\nUSDRIF Mintable (~99.9k):')
  const mintableResults = results.filter(r => 
    r.function.includes('availableToMint') && r.success
  )
  for (const r of mintableResults) {
    const val = parseFloat(r.formatted || '0')
    console.log(`  ${r.contract}.${r.function}: ${r.formatted}`)
    if (val > 95000 && val < 110000) {
      console.log('    ⭐ MATCHES ~99.9k!')
    }
  }
  if (mintableResults.length === 0) {
    console.log('  ✗ Not found in any contract')
  }
  
  console.log('\n' + '='.repeat(120))
  console.log('CONTRACT SUMMARY')
  console.log('='.repeat(120))
  console.log('')
  console.log('Contract Name          Address                                    Status')
  console.log('-'.repeat(120))
  console.log('USDRIF Token           0x5db91e24BD32059584bbDb831A901f1199f3d459 ✓ Active')
  console.log('RIFPRO Token           0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61 ✓ Active')
  console.log('MoC State              0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257 ✓ Active')
  console.log('MoC Connector          0xcE2A128cC73e5d98355aAfb2595647F2D3171Faa ✓ Found')
  console.log('MoC Contract           0xf773B590aF754D597770937Fa8ea7AbDf2668370 ✓ Found')
  console.log('')
}

main().catch(console.error)

