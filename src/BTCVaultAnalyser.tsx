import { useState, useCallback, useEffect, useMemo } from 'react'
import { AddressLinkWithRns } from './components/AddressLinkWithRns'
import { AnalyserShell } from './components/AnalyserShell'
import { CONFIG } from './config'
import { useRnsReverseLookup } from './hooks/useRnsReverseLookup'
import * as XLSX from 'xlsx'
import { formatAmount, formatAmountDisplay } from './utils/amount'
import { generateTimestampFilename, writeExcelWorkbook } from './utils/exportExcel'
import { userFacingError } from './utils/userFacingError'
import { BTC_VAULT_CHAIN } from './btcVault/network'
import { fetchBtcVaultTransactions } from './btcVault/fetchBtcVaultTransactions'
import { needsDistinctReceiverColumn } from './btcVault/helpers'
import { formatBtcVaultUsd, fetchRbtcUsdPrice } from './btcVault/price'
import type { BTCVaultChain, BTCVaultTransaction } from './btcVault/types'
import './MintRedeemAnalyser.css'

export type { BTCVaultChain } from './btcVault/types'

interface BTCVaultAnalyserProps {
  chain?: BTCVaultChain
  initialExpanded?: boolean
  initialDays?: number
}

export default function BTCVaultAnalyser({
  chain = 'testnet',
  initialExpanded,
  initialDays,
}: BTCVaultAnalyserProps = {}) {
  const net = BTC_VAULT_CHAIN[chain]
  const rnsRegistry = chain === 'mainnet' ? CONFIG.RNS_REGISTRY_MAINNET : CONFIG.RNS_REGISTRY_TESTNET

  const [transactions, setTransactions] = useState<BTCVaultTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(initialDays ?? 7)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(!(initialExpanded ?? false))
  const [rbtcUsd, setRbtcUsd] = useState<number | null>(null)

  const addressesForRns = useMemo(() => {
    const s = new Set<string>()
    for (const tx of transactions) {
      if (tx.user) s.add(tx.user)
      if (tx.receiver) s.add(tx.receiver)
    }
    return [...s]
  }, [transactions])
  const bensChainId = chain === 'mainnet' ? CONFIG.ROOTSTOCK_MAINNET_CHAIN_ID : CONFIG.ROOTSTOCK_TESTNET_CHAIN_ID
  const rnsLabels = useRnsReverseLookup(addressesForRns, bensChainId, net.rpcUrl, rnsRegistry, !isCollapsed)

  const showReceiverColumn = useMemo(() => needsDistinctReceiverColumn(transactions), [transactions])

  const loadPrice = useCallback(async () => {
    const price = await fetchRbtcUsdPrice()
    setRbtcUsd(price)
  }, [])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { recentTxs, rbtcUsd: price } = await fetchBtcVaultTransactions({ chain, days })
      setTransactions(recentTxs)
      setRbtcUsd(price)
      setLastUpdated(new Date())
    } catch (err) {
      setError(userFacingError(err))
    } finally {
      setLoading(false)
    }
  }, [chain, days])

  useEffect(() => {
    if (!isCollapsed) {
      loadPrice()
      fetchTransactions()
    }
  }, [isCollapsed, loadPrice, fetchTransactions])

  const exportToExcel = useCallback(() => {
    if (transactions.length === 0) {
      alert('No transactions to export')
      return
    }
    const rbtcAmounts = transactions.map((tx) => parseFloat(formatAmount(BigInt(tx.amount), 18)))
    const rows = transactions.map((tx, i) => {
      const amountRbtc = formatAmountDisplay(formatAmount(BigInt(tx.amount), 18), 8)
      const usdEquiv = rbtcUsd != null ? rbtcAmounts[i] * rbtcUsd : null
      const row: Record<string, string | number> = {
        Timestamp: tx.time.toISOString(),
        'Tx Hash': tx.hash,
        Type: tx.type,
        Status: tx.status,
        'Amount (RBTC)': amountRbtc,
        Shares: formatAmountDisplay(formatAmount(BigInt(tx.shares), 18), 8),
        'USD Equiv.': usdEquiv != null ? formatBtcVaultUsd(usdEquiv) : '',
        User: tx.user,
        'Epoch ID': tx.epochId ?? '',
        Block: tx.blockNumber,
      }
      if (showReceiverColumn) row['Receiver'] = tx.receiver
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, net.excelSheet)
    const filename = generateTimestampFilename(net.excelBaseName)
    writeExcelWorkbook(wb, filename)
  }, [transactions, rbtcUsd, net.excelBaseName, net.excelSheet, showReceiverColumn])

  const controls = (
    <>
      <div className="filter-toggle" />
      <div className="right-controls">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <button onClick={fetchTransactions} disabled={loading} aria-busy={loading}>
          {loading && <span className="refresh-spinner" />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button className="export-button" onClick={exportToExcel} disabled={loading}>
          XLS
        </button>
      </div>
    </>
  )

  return (
    <AnalyserShell
      title="BTC Vault"
      networkBadge={chain === 'mainnet' ? 'mainnet' : 'testnet'}
      isCollapsed={isCollapsed}
      onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      controls={controls}
      error={error}
      loading={loading}
      isEmpty={transactions.length === 0}
      emptyMessage="No BTC Vault transactions found in the selected period."
    >
      <div className="transactions-table-container btc-vault-table">
        <table className="transactions-table">
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>Status</th>
              <th>Type</th>
              <th>Amount (RBTC)</th>
              <th>Shares</th>
              <th>USD Equiv.</th>
              <th>User</th>
              <th className={showReceiverColumn ? undefined : 'btc-vault-receiver-col-hidden'}>Receiver</th>
              <th>Epoch</th>
              <th>Block</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, idx) => {
              const amountHuman = formatAmount(BigInt(tx.amount), 18)
              const amountDisplay = formatAmountDisplay(amountHuman, 8)
              const sharesHuman = formatAmount(BigInt(tx.shares), 18)
              const sharesDisplay = formatAmountDisplay(sharesHuman, 8)
              const usdProduct = rbtcUsd != null ? parseFloat(amountHuman) * rbtcUsd : Number.NaN
              const usdDisplay =
                rbtcUsd != null && Number.isFinite(usdProduct) ? formatBtcVaultUsd(usdProduct) : '—'

              return (
                <tr key={`${tx.hash}-${idx}`}>
                  <td className="hash-cell">
                    <a
                      href={`${net.explorerOrigin}/tx/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={tx.hash}
                    >
                      {tx.time.toISOString().replace('T', ' ').substring(0, 19)}
                    </a>
                  </td>
                  <td>{tx.status}</td>
                  <td
                    className={
                      tx.type.includes('Deposit') ? 'type-mint' : tx.type.includes('Redeem') ? 'type-redeem' : ''
                    }
                  >
                    {tx.type}
                  </td>
                  <td title={amountDisplay}>{amountDisplay}</td>
                  <td title={sharesDisplay}>{sharesDisplay}</td>
                  <td title={usdDisplay !== '—' ? usdDisplay : undefined}>{usdDisplay}</td>
                  <td className="address-cell">
                    {tx.user ? (
                      <AddressLinkWithRns
                        href={`${net.explorerOrigin}/address/${tx.user}`}
                        address={tx.user}
                        rnsByAddressLower={rnsLabels}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={`address-cell${showReceiverColumn ? '' : ' btc-vault-receiver-col-hidden'}`}
                  >
                    {tx.receiver ? (
                      <AddressLinkWithRns
                        href={`${net.explorerOrigin}/address/${tx.receiver}`}
                        address={tx.receiver}
                        rnsByAddressLower={rnsLabels}
                        shortenIfNoRns
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{tx.epochId ?? '—'}</td>
                  <td>
                    <a
                      href={`${net.explorerOrigin}/block/${tx.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {tx.blockNumber}
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {lastUpdated && (
          <div className="transactions-summary">
            <p className="last-updated">Last updated: {lastUpdated.toLocaleString()}</p>
          </div>
        )}
      </div>
    </AnalyserShell>
  )
}
