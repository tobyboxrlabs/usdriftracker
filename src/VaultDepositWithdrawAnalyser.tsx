import { useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { AnalyserShell } from './components/AnalyserShell'
import { AddressLinkWithRns } from './components/AddressLinkWithRns'
import { CONFIG } from './config'
import { useRnsReverseLookup } from './hooks/useRnsReverseLookup'
import { useCollapsibleTransactionAnalyser } from './hooks/useCollapsibleTransactionAnalyser'
import { formatAmountDisplay } from './utils/amount'
import { generateDateFilename, writeExcelWorkbook } from './utils/exportExcel'
import { logger } from './utils/logger'
import { fetchVaultDepositWithdrawTransactions } from './vaultDepositWithdraw/fetchVaultDepositWithdrawTransactions'
import type { VaultTransaction } from './vaultDepositWithdraw/types'
import './MintRedeemAnalyser.css'

interface VaultDepositWithdrawAnalyserProps {
  initialExpanded?: boolean
  initialDays?: number
}

export default function VaultDepositWithdrawAnalyser({
  initialExpanded,
  initialDays,
}: VaultDepositWithdrawAnalyserProps = {}) {
  const fetchRecentTxs = useCallback(
    (days: number, onProgress?: Parameters<typeof fetchVaultDepositWithdrawTransactions>[1]) =>
      fetchVaultDepositWithdrawTransactions(days, onProgress),
    []
  )

  const {
    transactions,
    loading,
    error,
    days,
    setDays,
    loadingProgress,
    lastUpdated,
    isCollapsed,
    setIsCollapsed,
    fetchTransactions,
  } = useCollapsibleTransactionAnalyser<VaultTransaction>({
    initialExpanded,
    initialDays,
    defaultDays: 1,
    fetchRecentTxs,
    onFetchError: (err) => logger.vault.error('Error fetching vault transactions:', err),
  })

  const addressesForRns = useMemo(() => transactions.map((tx) => tx.receiver), [transactions])
  const rnsLabels = useRnsReverseLookup(
    addressesForRns,
    CONFIG.ROOTSTOCK_MAINNET_CHAIN_ID,
    CONFIG.ROOTSTOCK_RPC,
    CONFIG.RNS_REGISTRY_MAINNET,
    !isCollapsed
  )

  const exportToExcel = useCallback((txsToExport: VaultTransaction[]) => {
    try {
      const wb = XLSX.utils.book_new()

      const excelData = txsToExport.map((tx) => ({
        'Time (UTC)': tx.time.toISOString().replace('T', ' ').substring(0, 19),
        'TX Hash': tx.hash,
        Status: tx.status,
        Asset: 'USDRIF',
        Type: tx.type,
        Amount: tx.amount,
        Receiver: tx.receiver,
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
        const displayText = tx.hash.substring(0, 10) + '...' + tx.hash.substring(tx.hash.length - 8)

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
        { 'Time (UTC)': 'Total Transactions:', Status: txsToExport.length },
        { 'Time (UTC)': 'Deposits:', Status: txsToExport.filter((tx) => tx.type === 'Deposit').length },
        { 'Time (UTC)': 'Withdrawals:', Status: txsToExport.filter((tx) => tx.type === 'Withdraw').length },
      ]

      XLSX.utils.sheet_add_json(ws, summaryData, { origin: `A${summaryStartRow}`, skipHeader: true })

      const sheetName = 'vUSD Transactions'
      XLSX.utils.book_append_sheet(wb, ws, sheetName)

      const filename = generateDateFilename('usd_vault_txs')
      writeExcelWorkbook(wb, filename)
    } catch (e) {
      logger.vault.error('Error exporting to Excel:', e)
      alert('Failed to export to Excel. Please try again.')
    }
  }, [])

  const controls = (
    <>
      <div className="filter-toggle">{/* vUSD only — no type filter */}</div>
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
        <button className="export-button" onClick={() => exportToExcel(transactions)} disabled={loading}>
          XLS
        </button>
      </div>
    </>
  )

  return (
    <AnalyserShell
      title="USD Vault"
      networkBadge="mainnet"
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      controls={controls}
      error={error}
      loading={loading}
      loadingProgress={loadingProgress}
      isEmpty={transactions.length === 0}
      emptyMessage="No vault transactions found in the selected period."
    >
      <div className="transactions-table-container">
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
            {transactions.map((tx, idx) => (
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
                <td>USDRIF</td>
                <td className={tx.type === 'Deposit' ? 'type-mint' : 'type-redeem'}>{tx.type}</td>
                <td title={tx.amount}>{formatAmountDisplay(tx.amount, 0)}</td>
                <td className="address-cell">
                  <AddressLinkWithRns
                    href={`https://rootstock.blockscout.com/address/${tx.receiver}`}
                    address={tx.receiver}
                    rnsByAddressLower={rnsLabels}
                  />
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
              Total Transactions: {transactions.length}, Deposits:{' '}
              {transactions.filter((tx) => tx.type === 'Deposit').length} | Withdrawals:{' '}
              {transactions.filter((tx) => tx.type === 'Withdraw').length}
              {(() => {
                const depositTotal = transactions
                  .filter((tx) => tx.type === 'Deposit')
                  .reduce((sum, tx) => sum + parseFloat(tx.amount || '0'), 0)

                const withdrawalTotal = transactions
                  .filter((tx) => tx.type === 'Withdraw')
                  .reduce((sum, tx) => sum + parseFloat(tx.amount || '0'), 0)

                return (
                  <>
                    , Deposits total: {formatAmountDisplay(depositTotal.toString(), 0)} | Withdrawals total:{' '}
                    {formatAmountDisplay(withdrawalTotal.toString(), 0)}
                  </>
                )
              })()}
            </p>
            {lastUpdated && (
              <p className="last-updated">
                Last updated: {lastUpdated.getFullYear()}
                {String(lastUpdated.getMonth() + 1).padStart(2, '0')}
                {String(lastUpdated.getDate()).padStart(2, '0')} {String(lastUpdated.getHours()).padStart(2, '0')}:
                {String(lastUpdated.getMinutes()).padStart(2, '0')}:{String(lastUpdated.getSeconds()).padStart(2, '0')}.
                {String(Math.floor(lastUpdated.getMilliseconds() / 10)).padStart(2, '0')}
              </p>
            )}
          </div>
        </div>
      </div>
    </AnalyserShell>
  )
}
