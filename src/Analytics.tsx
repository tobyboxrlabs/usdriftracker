import { Link, useSearchParams } from 'react-router-dom'
import MintRedeemAnalyser from './MintRedeemAnalyser'
import VaultDepositWithdrawAnalyser from './VaultDepositWithdrawAnalyser'
import BTCVaultAnalyser from './BTCVaultAnalyser'
import './Analytics.css'

const VALID_DAYS = [1, 7, 30, 90] as const

function parseDays(param: string | null): number {
  if (!param) return 7
  const n = parseInt(param, 10)
  return VALID_DAYS.includes(n as typeof VALID_DAYS[number]) ? n : 7
}

export default function Analytics() {
  const [searchParams] = useSearchParams()
  const analyser = searchParams.get('analyser')
  const daysParam = searchParams.get('days')
  const days = parseDays(daysParam)

  const usdrifExpanded = analyser === 'usdrif'
  const vusdExpanded = analyser === 'vusd'
  const vbtcExpanded = analyser === 'vbtc'

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <div className="analytics-header-title-row">
          <h1>Analytics</h1>
        </div>
        <p className="subtitle">Transaction analytics and insights... 😊</p>
        <div className="analytics-header-actions">
          <Link to="/" className="back-link">← Back to Metrics</Link>
          <Link to="/game" className="game-link">Play Light Cycle →</Link>
        </div>
      </header>

      <div className="analytics-container">
        <p className="app-disclaimer">
          Disclaimer: This is an unofficial, AI-generated app built for exploration and testing purposes only. It is not a RootstockLabs official product, and the information shown may be incomplete, inaccurate, or outdated. Do not rely on this app or its data for financial, operational, legal, product, GTM, or other decision-making purposes. Always verify any on-chain data through official Rootstock ecosystem trusted sources.
        </p>
        <MintRedeemAnalyser
          initialExpanded={usdrifExpanded}
          initialDays={usdrifExpanded ? days : undefined}
        />
        <VaultDepositWithdrawAnalyser
          initialExpanded={vusdExpanded}
          initialDays={vusdExpanded ? days : undefined}
        />
        <BTCVaultAnalyser
          initialExpanded={vbtcExpanded}
          initialDays={vbtcExpanded ? days : undefined}
        />
      </div>
    </div>
  )
}
