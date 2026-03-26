import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { CONFIG } from './config'
import { MetricsPage } from './pages/MetricsPage'
import { logger } from './utils/logger'
import './App.css'

const LightCycleGame = lazy(() => import('./LightCycleGame'))
const Analytics = lazy(() => import('./Analytics'))

function App() {
  const [deploymentCount, setDeploymentCount] = useState<number | null>(null)

  const fetchDeploymentCount = useCallback(async () => {
    if (import.meta.env.DEV) {
      logger.app.debug('Skipping deployment count fetch in local development')
      return
    }

    try {
      logger.app.debug('Fetching deployment count from /api/analytics...')
      const response = await fetch('/api/analytics', {
        headers: {
          'X-Client-Version': CONFIG.CLIENT_VERSION,
        },
      })
      logger.app.debug('Response status:', response.status, response.statusText)

      if (response.ok) {
        const contentType = response.headers.get('content-type')
        logger.app.debug('Content-Type:', contentType)

        if (contentType?.includes('application/json')) {
          const data = await response.json()
          logger.app.debug('Deployment count response:', data)

          if (data.message === 'Analytics not configured') {
            logger.app.warn('Analytics not configured - VERCEL_API_TOKEN missing')
            setDeploymentCount(null)
            return
          }

          if (data.totalDeployments !== undefined) {
            setDeploymentCount(data.totalDeployments)
            logger.app.debug('Set deployment count to:', data.totalDeployments)
          } else {
            logger.app.warn('Response missing totalDeployments field:', data)
          }
        } else {
          const text = await response.text()
          logger.app.error('Unexpected content type. Response:', text.substring(0, 200))
        }
      } else {
        logger.app.error('Failed to fetch deployment count:', response.status, response.statusText)
        const errorText = await response.text()
        logger.app.error('Error details:', errorText)
      }
    } catch (error) {
      logger.app.error('Failed to fetch deployment count:', error)
      if (error instanceof Error) {
        logger.app.error('Error message:', error.message)
        logger.app.debug('Stack:', error.stack)
      }
    }
  }, [])

  useEffect(() => {
    fetchDeploymentCount()
  }, [fetchDeploymentCount])

  return (
    <Suspense fallback={<div className="loading" role="status" aria-live="polite"><p>Loading...</p></div>}>
      <Routes>
        <Route path="/game" element={<LightCycleGame />} />
        <Route path="/tools" element={<Navigate to="/analytics" replace />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/" element={<MetricsPage deploymentCount={deploymentCount} />} />
      </Routes>
    </Suspense>
  )
}

export default App
