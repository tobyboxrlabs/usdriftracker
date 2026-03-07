/**
 * API endpoint to export transactions to Excel
 * This endpoint can call the Python script if Python is available,
 * or use xlsx library as fallback
 */

import { VercelRequest, VercelResponse } from '@vercel/node'
import * as XLSX from 'xlsx'
import { setCorsHeaders, setSecurityHeaders, checkRateLimit, getClientIp } from './security.js'

interface Transaction {
  time: string
  status: string
  asset: string
  type: string
  amountMintedRedeemed: string
  receiver: string
  blockNumber: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set security headers
  setSecurityHeaders(res)
  
  // Set CORS headers (restricted to allowed origins)
  setCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting: 30 requests per minute per IP
  const clientIp = getClientIp(req)
  if (!checkRateLimit(clientIp, 30, 60000)) {
    console.warn('[export-excel] Rate limit exceeded for IP:', clientIp)
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: 60
    })
  }

  try {
    const transactions: Transaction[] = req.body.transactions || []

    if (transactions.length === 0) {
      return res.status(400).json({ error: 'No transactions to export' })
    }

    // Create workbook
    const wb = XLSX.utils.book_new()

    // Prepare data for Excel
    const excelData = transactions.map(tx => ({
      'Time (UTC)': tx.time,
      'Status': tx.status,
      'Asset': tx.asset,
      'Type': tx.type,
      'Amount Minted/Redeemed': tx.amountMintedRedeemed,
      'Receiver': tx.receiver,
      'Block Number': tx.blockNumber,
    }))

    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(excelData)

    // Set column widths
    ws['!cols'] = [
      { wch: 20 }, // Time
      { wch: 12 }, // Status
      { wch: 12 }, // Asset
      { wch: 15 }, // Type
      { wch: 25 }, // Amount
      { wch: 45 }, // Receiver
      { wch: 15 }, // Block Number
    ]

    // Add worksheet to workbook (sheet name cannot contain : \ / ? * [ ])
    XLSX.utils.book_append_sheet(wb, ws, 'USDRIF Mint Redeem Transactions')

    // Generate Excel file buffer
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Set response headers with filename format: usdrif_txs_yyyymmdd.xlsx
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    const filename = `usdrif_txs_${year}${month}${day}.xlsx`
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    return res.send(excelBuffer)
  } catch (error) {
    console.error('Error exporting to Excel:', error)
    return res.status(500).json({ error: 'Failed to export to Excel' })
  }
}
