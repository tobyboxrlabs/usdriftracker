import { Link } from 'react-router-dom'
import { CONFIG } from '../config'
import { METRIC_KEYS } from '../history'
import { MetricDisplay } from '../components/MetricDisplay'
import { ContractAddressTable } from '../components/ContractAddressTable'
import { useTokenData } from '../hooks/useTokenData'

interface MetricsPageProps {
  deploymentCount: number | null
}

export function MetricsPage({ deploymentCount }: MetricsPageProps) {
  const { tokenData, refreshingMetrics, history, isClientOutdated, fetchTokenData } = useTokenData()

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <div className="header-title-row">
            <h1>PUT RIF TO WORK</h1>
          </div>
          <p className="subtitle">Real-time token metrics on Rootstock</p>
          <div className="header-meta">
            {import.meta.env.VITE_GIT_COMMIT_HASH && (
              <p className="git-hash">#{import.meta.env.VITE_GIT_COMMIT_HASH}</p>
            )}
            {deploymentCount !== null && deploymentCount > 0 && (
              <p className="deployment-count">Deployments: {deploymentCount} 😅</p>
            )}
          </div>
          <div className="header-actions">
            <Link to="/analytics" className="analytics-link">
              Analytics
            </Link>
            <Link to="/game" className="game-link">
              Play Light Cycle →
            </Link>
          </div>
        </header>

        <p className="app-disclaimer app-disclaimer--main">
          Disclaimer: This is an unofficial, AI-generated app built for exploration and testing
          purposes only. It is not a RootstockLabs official product, and the information shown
          may be incomplete, inaccurate, or outdated. Do not rely on this app or its data for
          financial, operational, legal, product, GTM, or other decision-making purposes.
          Always verify any on-chain data through official Rootstock ecosystem trusted sources.
        </p>

        <div className="card">
          <div className="card-header">
            <div className="card-header-title-row">
              <img
                src="https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzFsMWMxMzQ0bnY2ZTd2ejA2ZjNkamVteG9nNmhtenVja3VrbWZ6aCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/B0yg6yWnfVpEA/giphy.gif"
                alt="Animated GIF"
                className="header-gif"
              />
              <h2>RIF Metrics</h2>
            </div>
            {tokenData.lastUpdated &&
              (() => {
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
                const timeString = tokenData.lastUpdated.toLocaleTimeString()
                const timezoneDisplay = timezone.replace(/_/g, ' ')
                return (
                  <span className="last-updated">
                    Last updated: {timeString} ({timezoneDisplay})
                  </span>
                )
              })()}
          </div>

          {isClientOutdated ? (
            <div
              className="error"
              style={{
                backgroundColor: '#ff6b6b',
                color: 'white',
                padding: '20px',
                borderRadius: '8px',
                textAlign: 'center',
                marginBottom: '20px',
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: '10px' }}>⚠️ Client Version Outdated</h3>
              <p style={{ marginBottom: '15px' }}>
                Your browser is using an outdated version of this application. Please refresh the
                page to get the latest version.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="retry-button"
                style={{
                  backgroundColor: 'white',
                  color: '#ff6b6b',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                Refresh Page
              </button>
            </div>
          ) : tokenData.error ? (
            <div className="error">
              <p>⚠️ Error: {tokenData.error}</p>
              <button onClick={fetchTokenData} className="retry-button">
                Retry
              </button>
            </div>
          ) : (
            <div className="metrics">
              <MetricDisplay
                label="Staked RIF in Collective"
                value={tokenData.formattedStRIFSupply}
                unit="stRIF"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.ST_RIF_SUPPLY)}
                history={history.stRIFSupply}
                helpText="Sourced from the stRIF token contract (totalSupply). Represents the total amount of RIF tokens staked in the collective."
              />
              <MetricDisplay
                label="RIFPRO Total Supply"
                value={tokenData.formattedRifproSupply}
                unit="RIFPRO"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.RIFPRO_SUPPLY)}
                history={history.rifproSupply}
                helpText="Sourced from the RIFPRO token contract (totalSupply). Represents the total supply of RIFPRO tokens in circulation."
              />
              <MetricDisplay
                label="USDRIF Minted"
                value={tokenData.formattedMinted}
                unit="USD"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.MINTED)}
                history={history.minted}
                helpText="Sourced from the USDRIF token contract (totalSupply). Represents the total amount of USDRIF tokens that have been minted."
              />
              <MetricDisplay
                label="Staked USDRIF in USD Vault"
                value={tokenData.formattedVaultedUsdrif}
                unit="VUSD"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.VAULTED_USDRIF)}
                history={history.vaultedUsdrif}
                helpText="Sourced from the VUSD token contract (0xd8169270417050dCEf119597a7F6F5EE98dd2fd3) using totalSupply(). Represents the total amount of USDRIF staked in the USD vault."
              />
              <MetricDisplay
                label="RIF Price"
                value={tokenData.formattedRifPrice}
                unit="USD"
                formatOptions={{ maximumFractionDigits: 6, prefix: '$' }}
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.RIF_PRICE)}
                history={history.rifPrice}
                helpText="Sourced from the RLabs price feed oracle (0xbed51d83cc4676660e3fc3819dfad8238549b975) using the read() function. Represents the current RIF/USD price."
              />
              <MetricDisplay
                label="RIF Collateral Backing USDRIF"
                value={tokenData.formattedRifCollateral}
                unit="RIF"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.RIF_COLLATERAL)}
                history={history.rifCollateral}
                helpText="Sourced from MoC V2 Core contract (0xA27024Ed70035E46dba712609fc2Afa1c97aA36A) using getTotalACavailable(). Represents the total RIF collateral available in the system (~212M RIF)."
              />
              <MetricDisplay
                label="USDRIF Mintable"
                value={tokenData.formattedMaxMintable}
                unit="USD"
                isRefreshing={refreshingMetrics.has(METRIC_KEYS.MAX_MINTABLE)}
                history={history.maxMintable}
                helpText="Calculated using: (Total RIF Collateral ÷ Coverage Ratio) × RIF Price - Already Minted USDRIF. Coverage ratio sourced from MoC V2 Core calcCtargemaCA() (~5.5). RIF price from MoC price feed for calculation."
              />
            </div>
          )}

          <div className="card-footer">
            <button
              onClick={fetchTokenData}
              className="refresh-button"
              disabled={refreshingMetrics.size > 0}
              aria-busy={refreshingMetrics.size > 0}
              aria-live="polite"
            >
              {refreshingMetrics.size > 0 && <span className="refresh-spinner"></span>}
              {refreshingMetrics.size > 0 ? 'Refreshing...' : 'Refresh Now'}
            </button>
            <p className="info">
              Auto-refreshes every {Math.round(CONFIG.REFRESH_INTERVAL / 1000)} seconds
            </p>
          </div>
        </div>

        <ContractAddressTable />
      </div>
    </div>
  )
}
