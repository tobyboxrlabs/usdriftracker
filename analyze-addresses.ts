#!/usr/bin/env node
/**
 * Analyze Addresses - EOA vs Smart Contract vs Gnosis Safe Detection
 * 
 * This script reads a list of addresses from an Excel file and determines:
 * 1. Is it an EOA (Externally Owned Account)?
 * 2. Is it a smart contract?
 * 3. If smart contract, is it a Gnosis Safe?
 * 
 * Usage:
 *   npx tsx analyze-addresses.ts <excel-file-path>
 * 
 * Example:
 *   npx tsx analyze-addresses.ts /path/to/addresses.xlsx
 */

import { ethers } from 'ethers'
import * as fs from 'fs'
import * as path from 'path'
import XLSX from 'xlsx'

// Configuration
const ROOTSTOCK_RPC = process.env.VITE_ROOTSTOCK_RPC || 'https://public-node.rsk.co'

// Known Gnosis Safe singleton addresses on Rootstock
const GNOSIS_SAFE_SINGLETONS = [
  '0xC6cFa90Ff601D6AAC45D8dcF194cf38B91aCa368', // GnosisSafe (from docs)
]

// Gnosis Safe Proxy Factory
const GNOSIS_SAFE_PROXY_FACTORY = '0x4b1Af52EA200BAEbF79450DBC996573A7b75f65A'

// Gnosis Safe ABI - key functions to detect Safe contracts
const GNOSIS_SAFE_ABI = [
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function isOwner(address) view returns (bool)',
  'function getModules() view returns (address[])',
  'function VERSION() view returns (string)',
] as const

interface AddressAnalysis {
  address: string
  type: 'EOA' | 'Contract' | 'Unknown'
  isGnosisSafe: boolean
  gnosisSafeVersion?: string
  owners?: string[]
  threshold?: number
  error?: string
  // Original row data from Excel
  originalRow?: Record<string, any>
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getChecksummedAddress(address: string): Promise<string> {
  try {
    return ethers.getAddress(address)
  } catch {
    return ethers.getAddress(address.toLowerCase())
  }
}

async function isContract(provider: ethers.Provider, address: string): Promise<boolean> {
  try {
    const code = await provider.getCode(address)
    return code !== '0x' && code !== '0x0'
  } catch (error) {
    console.error(`Error checking contract code for ${address}:`, error)
    return false
  }
}

async function isGnosisSafe(
  provider: ethers.Provider,
  address: string
): Promise<{ isSafe: boolean; version?: string; owners?: string[]; threshold?: number }> {
  try {
    const checksummedAddress = await getChecksummedAddress(address)
    const safeContract = new ethers.Contract(checksummedAddress, GNOSIS_SAFE_ABI, provider)
    
    // Try to call getOwners() - this is a key Gnosis Safe function
    try {
      const owners = await safeContract.getOwners()
      const threshold = await safeContract.getThreshold()
      
      // Try to get version if available
      let version: string | undefined
      try {
        version = await safeContract.VERSION()
      } catch {
        // Version might not be available
      }
      
      return {
        isSafe: true,
        version: version || 'unknown',
        owners: owners.map((addr: string) => addr),
        threshold: Number(threshold),
      }
    } catch (error) {
      // If getOwners() fails, it's likely not a Gnosis Safe
      return { isSafe: false }
    }
  } catch (error) {
    return { isSafe: false }
  }
}

async function analyzeAddress(
  provider: ethers.Provider,
  address: string,
  originalRow: Record<string, any>,
  index: number,
  total: number
): Promise<AddressAnalysis> {
  try {
    const checksummedAddress = await getChecksummedAddress(address)
    
    // Check if it's a contract
    await delay(200) // Rate limit protection
    const hasCode = await isContract(provider, checksummedAddress)
    
    if (!hasCode) {
      return {
        address: checksummedAddress,
        type: 'EOA',
        isGnosisSafe: false,
        originalRow,
      }
    }
    
    // It's a contract, check if it's a Gnosis Safe
    await delay(200) // Rate limit protection
    const safeInfo = await isGnosisSafe(provider, checksummedAddress)
    
    return {
      address: checksummedAddress,
      type: 'Contract',
      isGnosisSafe: safeInfo.isSafe,
      gnosisSafeVersion: safeInfo.version,
      owners: safeInfo.owners,
      threshold: safeInfo.threshold,
      originalRow,
    }
  } catch (error) {
    return {
      address: address,
      type: 'Unknown',
      isGnosisSafe: false,
      error: error instanceof Error ? error.message : String(error),
      originalRow,
    }
  }
}

interface RowWithAddress {
  address: string
  originalRow: Record<string, any>
}

function readAddressesFromCSV(filePath: string): RowWithAddress[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(line => line.trim())
  const rows: RowWithAddress[] = []
  
  if (lines.length === 0) return rows
  
  // Parse header
  const headerLine = lines[0]
  const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  
  // Find address column index
  let addressColumnIndex = -1
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase()
    if (header.includes('address') || header.includes('wallet') || header.includes('recipient')) {
      addressColumnIndex = i
      break
    }
  }
  
  // If no address column found, try to find addresses in any column
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''))
    const rowData: Record<string, any> = {}
    
    // Build row data object
    for (let j = 0; j < headers.length && j < parts.length; j++) {
      rowData[headers[j]] = parts[j]
    }
    
    // Find address in row
    let address: string | null = null
    
    if (addressColumnIndex >= 0 && addressColumnIndex < parts.length) {
      const potentialAddress = parts[addressColumnIndex]
      if (/^0x[a-fA-F0-9]{40}$/.test(potentialAddress)) {
        address = potentialAddress
      }
    }
    
    // If not found in address column, search all columns
    if (!address) {
      for (const part of parts) {
        if (/^0x[a-fA-F0-9]{40}$/.test(part)) {
          address = part
          break
        }
      }
    }
    
    if (address) {
      rows.push({ address, originalRow: rowData })
    }
  }
  
  return rows
}

function readAddressesFromTXT(filePath: string): RowWithAddress[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(line => line.trim())
  const rows: RowWithAddress[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    // Check if it looks like an Ethereum address
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      rows.push({ address: trimmed, originalRow: {} })
    }
  }
  
  return rows
}

function readAddressesFromExcel(excelPath: string): RowWithAddress[] {
  const workbook = XLSX.readFile(excelPath)
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  
  // Convert to JSON to preserve all columns
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false })
  const rows: RowWithAddress[] = []
  
  // Find address column
  let addressKey: string | null = null
  if (jsonData.length > 0) {
    const firstRow = jsonData[0] as Record<string, any>
    for (const key of Object.keys(firstRow)) {
      const keyLower = key.toLowerCase()
      if (keyLower.includes('address') || keyLower.includes('wallet') || keyLower.includes('recipient')) {
        addressKey = key
        break
      }
    }
  }
  
  // Process each row
  for (const row of jsonData) {
    const rowData = row as Record<string, any>
    let address: string | null = null
    
    // Try to find address in the identified column
    if (addressKey && rowData[addressKey]) {
      const potentialAddress = String(rowData[addressKey]).trim()
      if (/^0x[a-fA-F0-9]{40}$/.test(potentialAddress)) {
        address = potentialAddress
      }
    }
    
    // If not found, search all columns
    if (!address) {
      for (const value of Object.values(rowData)) {
        const strValue = String(value).trim()
        if (/^0x[a-fA-F0-9]{40}$/.test(strValue)) {
          address = strValue
          break
        }
      }
    }
    
    if (address) {
      rows.push({ address, originalRow: rowData })
    }
  }
  
  return rows
}

function formatResults(results: AddressAnalysis[]): void {
  console.log('\n' + '='.repeat(120))
  console.log('ADDRESS ANALYSIS RESULTS')
  console.log('='.repeat(120))
  console.log('')
  
  const headers = ['Address', 'Type', 'Gnosis Safe?', 'Version', 'Owners', 'Threshold']
  const colWidths = [42, 12, 15, 10, 8, 10]
  
  console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' | '))
  console.log('-'.repeat(120))
  
  for (const result of results) {
    const address = result.address.substring(0, 40) + '...'
    const type = result.type.padEnd(12)
    const isSafe = result.isGnosisSafe ? '✅ Yes' : '❌ No'
    const version = (result.gnosisSafeVersion || '-').padEnd(10)
    const owners = result.owners ? result.owners.length.toString() : '-'
    const threshold = result.threshold ? result.threshold.toString() : '-'
    
    console.log([
      address.padEnd(colWidths[0]),
      type.padEnd(colWidths[1]),
      isSafe.padEnd(colWidths[2]),
      version.padEnd(colWidths[3]),
      owners.padEnd(colWidths[4]),
      threshold.padEnd(colWidths[5]),
    ].join(' | '))
    
    if (result.error) {
      console.log(`  ⚠️  Error: ${result.error}`)
    }
  }
  
  console.log('-'.repeat(120))
  
  const eoaCount = results.filter(r => r.type === 'EOA').length
  const contractCount = results.filter(r => r.type === 'Contract').length
  const safeCount = results.filter(r => r.isGnosisSafe).length
  const errorCount = results.filter(r => r.error).length
  
  console.log(`\nSummary:`)
  console.log(`  Total addresses: ${results.length}`)
  console.log(`  EOAs: ${eoaCount}`)
  console.log(`  Smart Contracts: ${contractCount}`)
  console.log(`  Gnosis Safes: ${safeCount}`)
  if (errorCount > 0) {
    console.log(`  Errors: ${errorCount}`)
  }
  console.log('='.repeat(120) + '\n')
}

function exportToCSV(results: AddressAnalysis[]): string {
  const escapeCSV = (value: string | undefined | null | any): string => {
    if (value === undefined || value === null) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }
  
  // Collect all unique column names from original rows
  const allColumns = new Set<string>()
  for (const result of results) {
    if (result.originalRow) {
      Object.keys(result.originalRow).forEach(key => allColumns.add(key))
    }
  }
  
  // Build headers: original columns first, then analysis columns
  const originalHeaders = Array.from(allColumns).sort()
  const analysisHeaders = [
    'Address (Analyzed)',
    'Type',
    'Is Gnosis Safe',
    'Gnosis Safe Version',
    'Owners Count',
    'Threshold',
    'Owners',
    'Error',
  ]
  
  const headers = [...originalHeaders, ...analysisHeaders]
  const rows: string[] = []
  rows.push(headers.map(h => `"${h}"`).join(','))
  
  for (const result of results) {
    const row: string[] = []
    
    // Add original row data
    for (const col of originalHeaders) {
      row.push(escapeCSV(result.originalRow?.[col]))
    }
    
    // Add analysis data
    row.push(
      escapeCSV(result.address),
      escapeCSV(result.type),
      escapeCSV(result.isGnosisSafe ? 'Yes' : 'No'),
      escapeCSV(result.gnosisSafeVersion),
      escapeCSV(result.owners ? result.owners.length.toString() : ''),
      escapeCSV(result.threshold ? result.threshold.toString() : ''),
      escapeCSV(result.owners ? result.owners.join(';') : ''),
      escapeCSV(result.error)
    )
    
    rows.push(row.join(','))
  }
  
  return rows.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.error('❌ Error: Please provide the path to the Excel file')
    console.error('Usage: npx tsx analyze-addresses.ts <excel-file-path>')
    console.error('Example: npx tsx analyze-addresses.ts /path/to/addresses.xlsx')
    process.exit(1)
  }
  
  const filePath = args[0]
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`)
    process.exit(1)
  }
  
  console.log('🔍 Analyzing Addresses...\n')
  console.log(`File: ${filePath}`)
  console.log(`RPC: ${ROOTSTOCK_RPC}\n`)
  
  // Read addresses from file (with original row data)
  let rowsWithAddresses: RowWithAddress[] = []
  const ext = path.extname(filePath).toLowerCase()
  
  try {
    if (ext === '.xlsx' || ext === '.xls') {
      console.log('📄 Reading Excel file...')
      rowsWithAddresses = readAddressesFromExcel(filePath)
    } else if (ext === '.csv') {
      console.log('📄 Reading CSV file...')
      rowsWithAddresses = readAddressesFromCSV(filePath)
    } else {
      console.log('📄 Reading text file...')
      rowsWithAddresses = readAddressesFromTXT(filePath)
    }
    
    if (rowsWithAddresses.length === 0) {
      console.error('❌ Error: No valid addresses found in file')
      console.error('Please ensure the file contains Ethereum addresses (0x followed by 40 hex characters)')
      process.exit(1)
    }
    
    console.log(`Found ${rowsWithAddresses.length} address${rowsWithAddresses.length !== 1 ? 'es' : ''}\n`)
    
    // Initialize provider
    const provider = new ethers.JsonRpcProvider(ROOTSTOCK_RPC)
    
    // Analyze each address
    console.log('🔍 Analyzing addresses...\n')
    const results: AddressAnalysis[] = []
    
    for (let i = 0; i < rowsWithAddresses.length; i++) {
      const { address, originalRow } = rowsWithAddresses[i]
      process.stdout.write(`\r  Progress: ${i + 1}/${rowsWithAddresses.length}`)
      
      const analysis = await analyzeAddress(provider, address, originalRow, i, rowsWithAddresses.length)
      results.push(analysis)
    }
    
    console.log('\n')
    
    // Display results
    formatResults(results)
    
    // Export to CSV
    const csvContent = exportToCSV(results)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const csvFilename = path.join(process.cwd(), `address-analysis-${timestamp}.csv`)
    
    try {
      fs.writeFileSync(csvFilename, csvContent, 'utf-8')
      console.log(`✅ Results exported to: ${csvFilename}\n`)
    } catch (error) {
      console.error(`❌ Error writing CSV file: ${error}\n`)
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
    if (error instanceof Error) {
      console.error('Message:', error.message)
      if (error.message.includes('xlsx')) {
        console.error('\n💡 Tip: Install the xlsx package: npm install xlsx')
        console.error('   Or convert your Excel file to CSV and use that instead.')
      }
    }
    process.exit(1)
  }
}

main()
