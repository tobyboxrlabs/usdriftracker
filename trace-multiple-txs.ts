/**
 * Trace multiple transactions to understand the business flow
 */

import { execSync } from 'child_process'

const txHashes = [
  '0x171322fb01fa7c1c607aca30e95b3a1b816ba1871c5faf17748b6702192357cc',
  '0x2c07bd7e82f2155df7f8dfe23cd5312821ab1ba1b86b0fa3cc6770383d4d992f',
  '0xa54e02e4e9de314be572fa5905966feb991eea3a65082d4a2b8b43e4c2c618da',
]

console.log(`Tracing ${txHashes.length} transactions...\n`)

for (const txHash of txHashes) {
  console.log(`\n${'='.repeat(100)}`)
  console.log(`TRACING: ${txHash}`)
  console.log(`${'='.repeat(100)}\n`)
  
  try {
    const output = execSync(`npx tsx test-trace-tx.ts ${txHash}`, { 
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024 
    })
    console.log(output)
  } catch (error: any) {
    console.error(`Error tracing ${txHash}:`, error.message)
  }
  
  // Add delay between traces
  await new Promise(resolve => setTimeout(resolve, 1000))
}

console.log(`\n${'='.repeat(100)}`)
console.log(`SUMMARY`)
console.log(`${'='.repeat(100)}`)
