/**
 * Shared Excel export utilities for transaction analysers.
 * Reduces duplication of filename generation and write logic.
 */
import * as XLSX from 'xlsx'

/**
 * Generate a date-based filename for transaction exports.
 * Format: {prefix}_{YYYYMMDD}.xlsx
 * Example: generateDateFilename('usdrif_txs') -> 'usdrif_txs_20250124.xlsx'
 */
export function generateDateFilename(prefix: string): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${prefix}_${year}${month}${day}.xlsx`
}

/**
 * Generate a timestamp-based filename for exports.
 * Format: {prefix}-{ISO-timestamp}.xlsx
 * Example: generateTimestampFilename('btc-vault-transactions') -> 'btc-vault-transactions-2025-01-24T12-30-45.xlsx'
 */
export function generateTimestampFilename(prefix: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  return `${prefix}-${ts}.xlsx`
}

/**
 * Write an XLSX workbook to file with standard error handling.
 * Shows alert on failure.
 */
export function writeExcelWorkbook(wb: XLSX.WorkBook, filename: string): void {
  try {
    XLSX.writeFile(wb, filename)
  } catch (error) {
    console.error('Error exporting to Excel:', error)
    alert('Failed to export to Excel. Please try again.')
  }
}
