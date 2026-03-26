import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { AnalyserShell } from './components/AnalyserShell'
import { formatAmountDisplay } from './utils/amount'
import { generateDateFilename, writeExcelWorkbook } from './utils/exportExcel'
import { logger } from './utils/logger'
import { userFacingError } from './utils/userFacingError'
import {
  fetchMintRedeemTransactions,
  type MintRedeemProgress,
} from './mintRedeem/fetchMintRedeemTransactions'
import type { MintRedeemTransaction } from './mintRedeem/types'
import './MintRedeemAnalyser.css'

interface MintRedeemAnalyserProps {
  initialExpanded?: boolean
  initialDays?: number
}

export default function MintRedeemAnalyser({
  initialExpanded,
  initialDays,
}: MintRedeemAnalyserProps = {}) {
  const [transactions, setTransactions] = useState<MintRedeemTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(initialDays ?? 1)
  const [tokenFilter, setTokenFilter] = useState<'USDRIF' | 'RifPro' | 'All'>('All')
  const [loadingProgress, setLoadingProgress] = useState<MintRedeemProgress | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(!(initialExpanded ?? false))
  const progressTimeoutRef = useRef<number | null>(null)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadingProgress(null)

    try {
      const { recentTxs } = await fetchMintRedeemTransactions(days, setLoadingProgress)
      setTransactions(recentTxs)
      setLastUpdated(new Date())
    } catch (err) {
      setError(userFacingError(err))
      logger.mintRedeem.error('Error fetching mint/redeem transactions:', err)
    } finally {
      setLoading(false)
      if (progressTimeoutRef.current) clearTimeout(progressTimeoutRef.current)
      progressTimeoutRef.current = window.setTimeout(() => setLoadingProgress(null), 500)
    }
  }, [days])

  useEffect(() => {
    if (!isCollapsed) {
      fetchTransactions()
    }
  }, [fetchTransactions, isCollapsed])

  useEffect(() => {
    return () => {
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current)
        progressTimeoutRef.current = null
      }
    }
  }, [])

  const exportToExcel = useCallback((txsToExport: MintRedeemTransaction[]) => {
    try {
      const wb = XLSX.utils.book_new()

      const excelData = txsToExport.map((tx) => ({
        'Time (UTC)': tx.time.toISOString().replace('T', ' ').substring(0, 19),
        'TX Hash': tx.hash,
        'Status': tx.status,
        'Asset': tx.type.includes('USDRIF') ? 'USDRIF' : 'RifPro',
        'Type': tx.type.includes('Mint') ? 'Mint' : 'Redeem',
        'Amount Minted/Redeemed': tx.amountMintedRedeemed,
        'Receiver': tx.receiver,
        'Block Number': tx.blockNumber,
      }))

      const ws = XLSX.utils.json_to_sheet(excelData)

      const txHashColIndex = 1
      const txHashColLetter = XLSX.utils.encode_col(txHashColIndex)

      for (let i = 0; i < txsToExport.length; i++) {
        const rowIndex = i + 2
        const tx = txsToExport[i]
        const cellAddress = `${txHashColLetter}${rowIndex}`
        const url = `https://rootstock.blockscout.com/tx/${tx.hash}`
        const displayText =
          tx.hash.substring(0, 10) + '...' + tx.hash.substring(tx.hash.length - 8)

        ws[cellAddress] = {
          t: 's',
          f: `HYPERLINK("${url}","${displayText}")`,
        }
      }

      ws['!cols'] = [
        { wch: 20 },
        { wch: 25 },
        { wch: 12 },
        { wch: 12 },
        { wch: 15 },
        { wch: 30 },
        { wch: 45 },
        { wch: 15 },
      ]

      const summaryStartRow = excelData.length + 3
      const summaryData = [
        {},
        { 'Time (UTC)': 'Total Transactions:', 'Status': txsToExport.length },
        { 'Time (UTC)': 'Mints:', 'Status': txsToExport.filter((tx) => tx.type.includes('Mint')).length },
        {
          'Time (UTC)': 'Redeems:',
          'Status': txsToExport.filter((tx) => tx.type.includes('Redeem')).length,
        },
      ]

      XLSX.utils.sheet_add_json(ws, summaryData, { origin: `A${summaryStartRow}`, skipHeader: true })

      const sheetName = 'USDRIF Mint Redeem Transactions'
      XLSX.utils.book_append_sheet(wb, ws, sheetName)

      const filename = generateDateFilename('usdrif_txs')
      writeExcelWorkbook(wb, filename)
    } catch (error) {
      logger.mintRedeem.error('Error exporting to Excel:', error)
      alert('Failed to export to Excel. Please try again.')
    }
  }, [])

  const controls = (
    <>
      <div className="filter-toggle">
        <button
          className={`filter-button ${tokenFilter === 'All' ? 'active' : ''}`}
          onClick={() => setTokenFilter('All')}
          aria-pressed={tokenFilter === 'All'}
        >
          All
        </button>
        <button
          className={`filter-button ${tokenFilter === 'USDRIF' ? 'active' : ''}`}
          onClick={() => setTokenFilter('USDRIF')}
          aria-pressed={tokenFilter === 'USDRIF'}
        >
          USDRIF
        </button>
        <button
          className={`filter-button ${tokenFilter === 'RifPro' ? 'active' : ''}`}
          onClick={() => setTokenFilter('RifPro')}
          aria-pressed={tokenFilter === 'RifPro'}
        >
          RifPro
        </button>
      </div>
      <div className="right-controls">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <button onClick={fetchTransactions} disabled={loading} aria-busy={loading}>
          {loading && <span className="refresh-spinner"></span>}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button
          className="export-button"
          onClick={() =>
            exportToExcel(
              transactions.filter((tx) =>
                tokenFilter === 'All' ? true : tx.type.includes(tokenFilter)
              )
            )
          }
          disabled={loading}
        >
          XLS
        </button>
      </div>
    </>
  )

  const filteredTransactions =
    tokenFilter === 'All'
      ? transactions
      : transactions.filter((tx) => tx.type.includes(tokenFilter))

  const tableContent =
    filteredTransactions.length === 0 ? (
      <div className="no-data" role="status" aria-live="polite">
        No {tokenFilter === 'All' ? '' : tokenFilter + ' '}transactions found with the selected
        filter.
        <br />
        <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>
          Try selecting a different time period or filter option.
        </span>
      </div>
    ) : (
      <>
        <table className="transactions-table">
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>Status</th>
              <th>Asset</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Receiver</th>
              <th>Block</th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.map((tx, idx) => (
              <tr key={`${tx.hash}-${idx}`}>
                <td className="hash-cell">
                  <a
                    href={`https://rootstock.blockscout.com/tx/${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tx.hash}
                  >
                    {tx.time.toISOString().replace('T', ' ').substring(0, 19)}
                  </a>
                </td>
                <td>{tx.status}</td>
                <td>{tx.type.includes('USDRIF') ? 'USDRIF' : 'RifPro'}</td>
                <td className={tx.type.includes('Mint') ? 'type-mint' : 'type-redeem'}>
                  {tx.type.includes('Mint') ? 'Mint' : 'Redeem'}
                </td>
                <td title={tx.amountMintedRedeemed}>
                  {formatAmountDisplay(tx.amountMintedRedeemed, 2)}
                </td>
                <td className="address-cell">
                  <a
                    href={`https://rootstock.blockscout.com/address/${tx.receiver}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tx.receiver}
                  >
                    {tx.receiver}
                  </a>
                </td>
                <td className="address-cell">
                  <a
                    href={`https://rootstock.blockscout.com/block/${tx.blockNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tx.blockNumber.toString()}
                  >
                    {tx.blockNumber}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="transactions-summary">
          <div className="summary-row">
            <p>
              Total Transactions: {filteredTransactions.length}
              {tokenFilter !== 'All' && ` (filtered from ${transactions.length})`}, Mints:{' '}
              {filteredTransactions.filter((tx) => tx.type.includes('Mint')).length} | Redeems:{' '}
              {filteredTransactions.filter((tx) => tx.type.includes('Redeem')).length}
              {tokenFilter === 'All' && (
                <>
                  , USDRIF: {filteredTransactions.filter((tx) => tx.type.includes('USDRIF')).length}{' '}
                  | RifPro: {filteredTransactions.filter((tx) => tx.type.includes('RifPro')).length}
                </>
              )}
              {(() => {
                const usdrifTotal = filteredTransactions
                  .filter((tx) => tx.type.includes('USDRIF'))
                  .reduce((sum, tx) => sum + parseFloat(tx.amountMintedRedeemed || '0'), 0)
                const rifproTotal = filteredTransactions
                  .filter((tx) => tx.type.includes('RifPro'))
                  .reduce((sum, tx) => sum + parseFloat(tx.amountMintedRedeemed || '0'), 0)
                return (
                  <>
                    , USDRIF total: {formatAmountDisplay(usdrifTotal.toString(), 0)} | RIFPRO total:{' '}
                    {formatAmountDisplay(rifproTotal.toString(), 0)}
                  </>
                )
              })()}
            </p>
            {lastUpdated && (
              <p className="last-updated">
                Last updated: {lastUpdated.getFullYear()}
                {String(lastUpdated.getMonth() + 1).padStart(2, '0')}
                {String(lastUpdated.getDate()).padStart(2, '0')} {String(lastUpdated.getHours()).padStart(2, '0')}:
                {String(lastUpdated.getMinutes()).padStart(2, '0')}:
                {String(lastUpdated.getSeconds()).padStart(2, '0')}.
                {String(Math.floor(lastUpdated.getMilliseconds() / 10)).padStart(2, '0')}
              </p>
            )}
          </div>
        </div>
      </>
    )

  return (
    <AnalyserShell
      title="USDRIF"
      networkBadge="mainnet"
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      controls={controls}
      error={error}
      loading={loading}
      loadingProgress={loadingProgress}
      isEmpty={transactions.length === 0}
      emptyMessage="No mint/redeem transactions found in the selected period."
    >
      <div className="transactions-table-container">{tableContent}</div>
    </AnalyserShell>
  )
}
