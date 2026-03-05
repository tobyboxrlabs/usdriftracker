/**
 * Test script to trace a transaction through Blockscout internal transactions
 * to find the original end-user receiver address.
 * 
 * Usage: node --loader tsx test-trace-tx.ts <TX_HASH>
 *    or: npx tsx test-trace-tx.ts <TX_HASH>
 */

const BLOCKSCOUT_API = 'https://rootstock.blockscout.com/api'

interface BlockscoutInternalTx {
  transaction_hash: string
  block: number
  from: string
  to: string
  value: string
  gas_used: string
  gas: string
  input: string
  output: string
  trace_type: string
  call_type?: string
  error?: string
  created_contract?: string
  index?: number
}

interface BlockscoutTxReceipt {
  transactionHash: string
  from: string
  to: string
  value: string
  gasUsed: string
  logs: Array<{
    address: string
    topics: string[]
    data: string
    logIndex: string
  }>
}

async function fetchInternalTransactions(txHash: string): Promise<BlockscoutInternalTx[]> {
  // Try multiple endpoints - Blockscout API format varies
  const endpoints = [
    `${BLOCKSCOUT_API}?module=account&action=txlistinternal&txhash=${txHash}`,
    `${BLOCKSCOUT_API}?module=transaction&action=getinternaltransactions&txhash=${txHash}`,
  ]
  
  console.log(`\n[TRACE] Fetching internal transactions...`)
  
  for (const url of endpoints) {
    try {
      console.log(`  Trying: ${url}`)
      const response = await fetch(url)
      if (!response.ok) {
        if (response.status === 400) {
          console.log(`    Got 400, trying next endpoint...`)
        }
        continue
      }
      
      const data = await response.json() as { status: string; message: string; result: BlockscoutInternalTx[] }
      
      if (data.status === '1' && data.result && Array.isArray(data.result) && data.result.length > 0) {
        console.log(`  ✓ Found ${data.result.length} internal transactions`)
        return data.result
      } else if (data.status === '0') {
        console.log(`    No internal transactions: ${data.message}`)
      }
    } catch (error) {
      console.log(`    Error: ${error}`)
      // Try next endpoint
      continue
    }
  }
  
  console.log(`  No internal transactions found via standard endpoints`)
  return []
}

async function fetchTransactionReceipt(txHash: string): Promise<BlockscoutTxReceipt | null> {
  // Try the transaction info endpoint first (more reliable)
  let url = `${BLOCKSCOUT_API}?module=transaction&action=gettxinfo&txhash=${txHash}`
  console.log(`\n[TRACE] Fetching transaction receipt from: ${url}`)
  
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json() as any
    
    // Blockscout transaction info format
    if (data.status === '1' && data.result) {
      const txInfo = data.result
      // Convert to our format
      return {
        transactionHash: txHash,
        from: txInfo.from || '',
        to: txInfo.to || '',
        value: txInfo.value || '0',
        gasUsed: txInfo.gasUsed || '0',
        logs: (txInfo.logs || []).map((log: any) => ({
          address: log.address || '',
          topics: log.topics || [],
          data: log.data || '0x',
          logIndex: log.logIndex || '0x0',
        })),
      }
    }
    
    // Fallback: Try proxy endpoint
    url = `${BLOCKSCOUT_API}?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}`
    const proxyResponse = await fetch(url)
    if (proxyResponse.ok) {
      const proxyData = await proxyResponse.json() as { result: BlockscoutTxReceipt }
      if (proxyData.result) {
        return proxyData.result
      }
    }
    
    return null
  } catch (error) {
    console.error(`[TRACE] Error fetching transaction receipt:`, error)
    return null
  }
}

async function fetchTransactionDetails(txHash: string) {
  const url = `${BLOCKSCOUT_API}?module=transaction&action=gettxinfo&txhash=${txHash}`
  console.log(`\n[TRACE] Fetching transaction details from: ${url}`)
  
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    return data
  } catch (error) {
    console.error(`[TRACE] Error fetching transaction details:`, error)
    return null
  }
}

async function fetchAllTokenTransfers(txHash: string): Promise<Array<{
  token: string
  tokenName: string
  from: string
  to: string
  value: string
  logIndex: string
}>> {
  const receipt = await fetchTransactionReceipt(txHash)
  if (!receipt || !receipt.logs) return []
  
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const USDRIF_ADDRESS = '0x3a15461d8ae0f0fb5fa2629e9da7d66a794a6e37'
  const RIFPRO_ADDRESS = '0x2d919f19d4892381d58edeBeca66D5642Cef1a1f'
  const RIF_TOKEN_ADDRESS = '0x2acc95758f8b5f583470ba265eb685a8f45fc9d5'
  
  const tokenTransfers: Array<{
    token: string
    tokenName: string
    from: string
    to: string
    value: string
    logIndex: string
  }> = []
  
  for (const log of receipt.logs) {
    if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
      const from = '0x' + log.topics[1].slice(-40).toLowerCase()
      const to = '0x' + log.topics[2].slice(-40).toLowerCase()
      const value = BigInt(log.data || '0x0').toString()
      const tokenAddr = log.address.toLowerCase()
      
      let tokenName = 'UNKNOWN'
      if (tokenAddr === USDRIF_ADDRESS.toLowerCase()) {
        tokenName = 'USDRIF'
      } else if (tokenAddr === RIFPRO_ADDRESS.toLowerCase()) {
        tokenName = 'RifPro'
      } else if (tokenAddr === RIF_TOKEN_ADDRESS.toLowerCase()) {
        tokenName = 'RIF'
      }
      
      tokenTransfers.push({
        token: tokenAddr,
        tokenName,
        from,
        to,
        value,
        logIndex: log.logIndex,
      })
    }
  }
  
  return tokenTransfers.sort((a, b) => parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16))
}

function analyzeTransactionFlow(
  txHash: string,
  receipt: BlockscoutTxReceipt,
  internalTxs: BlockscoutInternalTx[],
  tokenTransfers: Array<{ token: string; tokenName: string; from: string; to: string; value: string; logIndex: string }>
) {
  const USDRIF_ADDRESS = '0x3a15461d8ae0f0fb5fa2629e9da7d66a794a6e37'
  const RIFPRO_ADDRESS = '0x2d919f19d4892381d58edeBeca66D5642Cef1a1f'
  const RIF_TOKEN_ADDRESS = '0x2acc95758f8b5f583470ba265eb685a8f45fc9d5'
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`TRANSACTION FLOW ANALYSIS`)
  console.log(`${'='.repeat(80)}`)
  
  console.log(`\n[MAIN TX]`)
  console.log(`  Hash: ${txHash}`)
  console.log(`  From: ${receipt.from}`)
  console.log(`  To:   ${receipt.to}`)
  console.log(`  Value: ${receipt.value}`)
  console.log(`  Logs: ${receipt.logs.length}`)
  
  // Token transfers are now passed as parameter
  
  console.log(`\n[ALL TOKEN TRANSFERS] (in execution order)`)
  if (tokenTransfers.length === 0) {
    console.log(`  None found`)
  } else {
    tokenTransfers.forEach((tx, i) => {
      console.log(`  ${i + 1}. [${tx.tokenName}]`)
      console.log(`     From: ${tx.from}`)
      console.log(`     To:   ${tx.to}`)
      console.log(`     Value: ${tx.value}`)
      console.log(`     Log Index: ${tx.logIndex}`)
    })
  }
  
  console.log(`\n[USDRIF TRANSFERS]`)
  const usdrifTransfers = tokenTransfers.filter(t => t.tokenName === 'USDRIF')
  if (usdrifTransfers.length === 0) {
    console.log(`  None found`)
  } else {
    usdrifTransfers.forEach((tx, i) => {
      console.log(`  ${i + 1}. From: ${tx.from}`)
      console.log(`     To:   ${tx.to}`)
      console.log(`     Value: ${tx.value}`)
    })
  }
  
  console.log(`\n[RIF TRANSFERS]`)
  const rifTransfers = tokenTransfers.filter(t => t.tokenName === 'RIF')
  if (rifTransfers.length === 0) {
    console.log(`  None found`)
  } else {
    rifTransfers.forEach((tx, i) => {
      console.log(`  ${i + 1}. From: ${tx.from}`)
      console.log(`     To:   ${tx.to}`)
      console.log(`     Value: ${tx.value}`)
    })
  }
  
  console.log(`\n[INTERNAL TRANSACTIONS] (${internalTxs.length} total)`)
  
  if (internalTxs.length === 0) {
    console.log(`  No internal transactions found`)
    console.log(`\n[CONCLUSION]`)
    console.log(`  Original caller: ${receipt.from}`)
    return receipt.from
  }
  
  // Build a call tree
  const callTree: Array<{
    level: number
    from: string
    to: string
    value: string
    type: string
    callType?: string
    index?: number
  }> = []
  
  // Sort by index if available, otherwise by order
  const sorted = [...internalTxs].sort((a, b) => {
    if (a.index !== undefined && b.index !== undefined) {
      return a.index - b.index
    }
    return 0
  })
  
  for (const itx of sorted) {
    callTree.push({
      level: 0, // We'll determine depth later
      from: itx.from.toLowerCase(),
      to: itx.to.toLowerCase(),
      value: itx.value,
      type: itx.trace_type,
      callType: itx.call_type,
      index: itx.index,
    })
  }
  
  // Find the deepest call (likely the original user)
  // Look for calls that originate from EOA (Externally Owned Accounts)
  // EOA addresses typically don't appear as 'to' in many internal transactions
  
  const allAddresses = new Set<string>()
  callTree.forEach(tx => {
    allAddresses.add(tx.from)
    allAddresses.add(tx.to)
  })
  
  // Find addresses that only appear as 'from' (likely original callers)
  const fromOnlyAddresses = new Set<string>()
  const toAddresses = new Set<string>()
  
  callTree.forEach(tx => {
    fromOnlyAddresses.add(tx.from)
    toAddresses.add(tx.to)
  })
  
  // Original caller is likely an address that appears as 'from' but not as 'to' in internal txs
  // and is not the main transaction 'to' address
  const potentialCallers = Array.from(fromOnlyAddresses).filter(
    addr => !toAddresses.has(addr) && addr !== receipt.to.toLowerCase()
  )
  
  console.log(`\n  Call chain:`)
  callTree.forEach((tx, i) => {
    const indent = '  '.repeat(tx.level + 1)
    console.log(`${indent}${i + 1}. ${tx.type}${tx.callType ? ` (${tx.callType})` : ''}`)
    console.log(`${indent}   From: ${tx.from}`)
    console.log(`${indent}   To:   ${tx.to}`)
    if (tx.value !== '0') {
      console.log(`${indent}   Value: ${tx.value}`)
    }
  })
  
  console.log(`\n[ANALYSIS]`)
  console.log(`  Main TX from: ${receipt.from}`)
  console.log(`  Main TX to:   ${receipt.to}`)
  console.log(`  Potential original callers (from-only addresses):`)
  potentialCallers.forEach((addr, i) => {
    console.log(`    ${i + 1}. ${addr}`)
  })
  
  // Determine if this is a mint or redeem based on USDRIF transfers (already extracted above)
  const isRedeem = usdrifTransfers.some(tx => tx.from !== '0x0000000000000000000000000000000000000000')
  const isMint = usdrifTransfers.some(tx => tx.to !== '0x0000000000000000000000000000000000000000')
  
  console.log(`\n[TRANSACTION TYPE]`)
  console.log(`  Mint: ${isMint}`)
  console.log(`  Redeem: ${isRedeem}`)
  
  // Known contract addresses (these are not end users)
  // Common MoC-related contracts
  const mocContracts = [
    '0xf773b590af754d597770937fa8ea7abd2668370', // MoC contract
    '0xb9c42efc8ec54490a37ca91c423f7285fa01e257', // MoC State
    '0x8d7c61aab2db42739560682a4f949765ce48feaa', // Queue contract (from user's issue)
    '0xa27024ed70035e46dba712609fc2afa1c97aa36a', // MoC V2 Core (from CONFIG)
  ]
  
  const knownContracts = new Set([
    receipt.to.toLowerCase(),
    receipt.from.toLowerCase(), // Main TX from (likely queue contract)
    USDRIF_ADDRESS.toLowerCase(),
    RIFPRO_ADDRESS.toLowerCase(),
    RIF_TOKEN_ADDRESS.toLowerCase(),
    ...mocContracts.map(addr => addr.toLowerCase()),
  ])
  
  // Also add all addresses that appear as 'to' in internal transactions (likely contracts)
  internalTxs.forEach(itx => {
    if (itx.to) {
      knownContracts.add(itx.to.toLowerCase())
    }
  })
  
  let originalCaller = receipt.from.toLowerCase()
  
  // Strategy 1: For redeems, RIF is transferred TO the user
  // Find the RIF transfer that goes to an address that's not a known contract
  // Prioritize the largest RIF transfer (likely the main user)
  if (isRedeem && rifTransfers.length > 0) {
    console.log(`\n[STRATEGY 1] Looking for RIF recipient (redeem)...`)
    // Sort by value (largest first) - the main user transfer is usually the largest
    const sortedRifTransfers = [...rifTransfers].sort((a, b) => {
      const valA = BigInt(a.value)
      const valB = BigInt(b.value)
      return valA > valB ? -1 : valA < valB ? 1 : 0
    })
    
    for (const rifTx of sortedRifTransfers) {
      const recipient = rifTx.to.toLowerCase()
      if (!knownContracts.has(recipient) && rifTx.value !== '0') {
        console.log(`  ✓ Found RIF transfer to non-contract address: ${recipient} (value: ${rifTx.value})`)
        originalCaller = recipient
        break
      } else {
        console.log(`  ✗ Skipping contract address: ${recipient}`)
      }
    }
  }
  
  // Strategy 1b: Even if not identified as redeem, check RIF transfers for non-contract recipients
  // This handles cases where USDRIF transfers aren't detected but RIF is still transferred
  if (!isRedeem && !isMint && rifTransfers.length > 0) {
    console.log(`\n[STRATEGY 1b] Checking RIF transfers (transaction type unclear)...`)
    const sortedRifTransfers = [...rifTransfers].sort((a, b) => {
      const valA = BigInt(a.value)
      const valB = BigInt(b.value)
      return valA > valB ? -1 : valA < valB ? 1 : 0
    })
    
    for (const rifTx of sortedRifTransfers) {
      const recipient = rifTx.to.toLowerCase()
      if (!knownContracts.has(recipient) && rifTx.value !== '0') {
        console.log(`  ✓ Found large RIF transfer to non-contract address: ${recipient} (value: ${rifTx.value})`)
        // Only use this if we haven't found a better candidate
        if (knownContracts.has(originalCaller)) {
          originalCaller = recipient
        }
        break
      }
    }
  }
  
  // Strategy 2: For mints, RIF is transferred FROM the user
  if (isMint && rifTransfers.length > 0) {
    console.log(`\n[STRATEGY 2] Looking for RIF sender (mint)...`)
    for (const rifTx of rifTransfers) {
      const sender = rifTx.from.toLowerCase()
      if (!knownContracts.has(sender) && rifTx.value !== '0') {
        console.log(`  ✓ Found RIF transfer from non-contract address: ${sender}`)
        originalCaller = sender
        break
      } else {
        console.log(`  ✗ Skipping contract address: ${sender}`)
      }
    }
  }
  
  // Strategy 3: Use internal transaction analysis
  if (potentialCallers.length > 0) {
    console.log(`\n[STRATEGY 3] Analyzing internal transaction callers...`)
    for (const caller of potentialCallers) {
      if (!knownContracts.has(caller)) {
        console.log(`  ✓ Found potential caller from internal txs: ${caller}`)
        originalCaller = caller
        break
      } else {
        console.log(`  ✗ Skipping contract caller: ${caller}`)
      }
    }
  }
  
  // Strategy 4: Check USDRIF transfer recipient (for mints) or sender (for redeems)
  if (usdrifTransfers.length > 0) {
    console.log(`\n[STRATEGY 4] Checking USDRIF transfer addresses...`)
    for (const usdrifTx of usdrifTransfers) {
      if (isMint) {
        const recipient = usdrifTx.to.toLowerCase()
        if (!knownContracts.has(recipient)) {
          console.log(`  ✓ Found USDRIF mint recipient: ${recipient}`)
          originalCaller = recipient
          break
        }
      } else if (isRedeem) {
        const sender = usdrifTx.from.toLowerCase()
        if (!knownContracts.has(sender)) {
          console.log(`  ✓ Found USDRIF redeem sender: ${sender}`)
          originalCaller = sender
          break
        }
      }
    }
  }
  
  console.log(`\n[CONCLUSION]`)
  console.log(`  Original caller/receiver: ${originalCaller}`)
  console.log(`  Main TX from: ${receipt.from}`)
  console.log(`  Difference: ${originalCaller !== receipt.from.toLowerCase() ? 'YES - Found different address!' : 'NO - Same as main TX from'}`)
  
  return originalCaller
}

async function main() {
  const txHash = process.argv[2]
  
  if (!txHash) {
    console.error('Usage: npx tsx test-trace-tx.ts <TX_HASH>')
    console.error('\nExample:')
    console.error('  npx tsx test-trace-tx.ts 0x42f0e96b1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
    process.exit(1)
  }
  
  console.log(`Tracing transaction: ${txHash}`)
  console.log(`Blockscout API: ${BLOCKSCOUT_API}`)
  
  // Fetch transaction receipt
  const receipt = await fetchTransactionReceipt(txHash)
  if (!receipt) {
    console.error('Failed to fetch transaction receipt')
    process.exit(1)
  }
  
  // Fetch internal transactions
  const internalTxs = await fetchInternalTransactions(txHash)
  
  // Fetch all token transfers
  const tokenTransfers = await fetchAllTokenTransfers(txHash)
  
  // Analyze the flow
  const originalCaller = analyzeTransactionFlow(txHash, receipt, internalTxs, tokenTransfers)
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`RESULT: ${originalCaller}`)
  console.log(`${'='.repeat(80)}\n`)
}

main().catch(console.error)
