import { RootstockLogo } from '../RootstockLogo'
import '../MintRedeemAnalyser.css'

export interface AnalyserShellProps {
  title: string
  networkBadge: 'mainnet' | 'testnet'
  isCollapsed: boolean
  onToggleCollapse: () => void
  controls: React.ReactNode
  error: string | null
  loading: boolean
  loadingProgress?: { current: number; total: number; phase: string } | null
  isEmpty: boolean
  emptyMessage: string
  children: React.ReactNode
}

export function AnalyserShell({
  title,
  networkBadge,
  isCollapsed,
  onToggleCollapse,
  controls,
  error,
  loading,
  loadingProgress,
  isEmpty,
  emptyMessage,
  children,
}: AnalyserShellProps) {
  const badgeTitle = networkBadge === 'mainnet' ? 'Rootstock Mainnet' : 'Rootstock Testnet'
  const badgeLabel = networkBadge === 'mainnet' ? 'Mainnet' : 'Testnet'

  return (
    <div className={`analyser-shell mint-redeem-analyser ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="analyser-header">
        <h2>{title}</h2>
        <span
          className={`network-badge network-badge--${networkBadge}`}
          title={badgeTitle}
        >
          <RootstockLogo className="network-badge__logo" />
          {badgeLabel}
        </span>
        <button
          className="collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        {!isCollapsed && <div className="analyser-controls">{controls}</div>}
      </div>

      {!isCollapsed && (
        <>
          {error && (
            <div className="error-message">
              Error: {error}
            </div>
          )}

          {loading && (
            <div className="loading-message" role="status" aria-live="polite">
              {loadingProgress ? (
                <>
                  <div>{loadingProgress.phase}</div>
                  <div className="loading-progress">
                    {loadingProgress.total > 0 ? (
                      <div className="loading-progress-row">
                        <div className="loading-progress-bar">
                          <div
                            className={`loading-progress-fill ${
                              loadingProgress.current === 100 ? 'complete' : ''
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                (loadingProgress.current / loadingProgress.total) * 100
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="loading-progress-text">
                          {loadingProgress.current}%
                        </div>
                      </div>
                    ) : (
                      <div>Initializing...</div>
                    )}
                  </div>
                </>
              ) : (
                'Loading transactions...'
              )}
            </div>
          )}

          {!loading && isEmpty && !error && (
            <div className="no-data" role="status" aria-live="polite">
              {emptyMessage}
            </div>
          )}

          {!loading && !isEmpty && !error && children}
        </>
      )}
    </div>
  )
}
