import { Link } from 'react-router-dom'
import MintRedeemAnalyser from './MintRedeemAnalyser'
import VaultDepositWithdrawAnalyser from './VaultDepositWithdrawAnalyser'
import './Analytics.css'

export default function Analytics() {
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
        <MintRedeemAnalyser />
        <VaultDepositWithdrawAnalyser />
      </div>
    </div>
  )
}
