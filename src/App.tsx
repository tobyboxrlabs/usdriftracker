import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { CONFIG } from './config'
import { MetricsPage } from './pages/MetricsPage'
import './App.css'

const LightCycleGame = lazy(() => import('./LightCycleGame'))
const Analytics = lazy(() => import('./Analytics'))

function App() {
  const [deploymentCount, setDeploymentCount] = useState<number | null>(null)

  const fetchDeploymentCount = useCallback(async () => {
    if (import.meta.env.DEV) {
      console.log('Skipping deployment count fetch in local development')
      return
    }

    try {
      console.log('Fetching deployment count from /api/analytics...')
      const response = await fetch('/api/analytics', {
        headers: {
          'X-Client-Version': CONFIG.CLIENT_VERSION,
        },
      })
      console.log('Response status:', response.status, response.statusText)

      if (response.ok) {
        const contentType = response.headers.get('content-type')
        console.log('Content-Type:', contentType)

        if (contentType?.includes('application/json')) {
          const data = await response.json()
          console.log('Deployment count response:', data)

          if (data.message === 'Analytics not configured') {
            console.warn(
              'Analytics not configured - VERCEL_API_TOKEN missing in Vercel environment variables'
            )
            setDeploymentCount(null)
            return
          }

          if (data.totalDeployments !== undefined) {
            setDeploymentCount(data.totalDeployments)
            console.log('Set deployment count to:', data.totalDeployments)
          } else {
            console.warn('Response missing totalDeployments field:', data)
          }
        } else {
          const text = await response.text()
          console.error('Unexpected content type. Response:', text.substring(0, 200))
        }
      } else {
        console.error('Failed to fetch deployment count:', response.status, response.statusText)
        const errorText = await response.text()
        console.error('Error details:', errorText)
      }
    } catch (error) {
      console.error('Failed to fetch deployment count:', error)
      if (error instanceof Error) {
        console.error('Error message:', error.message)
        console.error('Error stack:', error.stack)
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
