import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import './LightCycleGame.css'

const GRID_SIZE = 20
const CELL_SIZE = 20
const INITIAL_SPEED = 150

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
type Position = { x: number; y: number }
type LeaderboardEntry = {
  score: number
  timestamp: number
  playerName?: string
  date?: string
  time?: string
  timezone?: string
}

export default function LightCycleGame() {
  const [cycle, setCycle] = useState<Position>({ x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) })
  const [trail, setTrail] = useState<Position[]>([])
  const [gameOver, setGameOver] = useState(false)
  const [gameStarted, setGameStarted] = useState(false)
  const [score, setScore] = useState(0)
  const [speed, setSpeed] = useState(INITIAL_SPEED)
  const directionRef = useRef<Direction>('RIGHT')
  const gameLoopRef = useRef<number>()
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [playerName, setPlayerName] = useState('')
  const [scoreSubmitted, setScoreSubmitted] = useState(false)
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false)

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                  (window.innerWidth <= 768 && 'ontouchstart' in window))
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const changeDirection = useCallback((newDir: Direction) => {
    if (gameOver || !gameStarted) return

    const currentDir = directionRef.current

    // Prevent reversing into itself
    if (newDir === 'UP' && currentDir !== 'DOWN') {
      directionRef.current = 'UP'
    } else if (newDir === 'DOWN' && currentDir !== 'UP') {
      directionRef.current = 'DOWN'
    } else if (newDir === 'LEFT' && currentDir !== 'RIGHT') {
      directionRef.current = 'LEFT'
    } else if (newDir === 'RIGHT' && currentDir !== 'LEFT') {
      directionRef.current = 'RIGHT'
    }
  }, [gameOver, gameStarted])

  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    if (gameOver || !gameStarted) return

    const key = e.key
    if (key === 'ArrowUp') {
      changeDirection('UP')
    } else if (key === 'ArrowDown') {
      changeDirection('DOWN')
    } else if (key === 'ArrowLeft') {
      changeDirection('LEFT')
    } else if (key === 'ArrowRight') {
      changeDirection('RIGHT')
    }
  }, [gameOver, gameStarted, changeDirection])

  // Touch handlers for swipe gestures
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (gameOver || !gameStarted) return
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, [gameOver, gameStarted])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (gameOver || !gameStarted || !touchStartRef.current) return
    
    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - touchStartRef.current.x
    const deltaY = touch.clientY - touchStartRef.current.y
    const minSwipeDistance = 30

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      // Horizontal swipe
      if (Math.abs(deltaX) > minSwipeDistance) {
        if (deltaX > 0) {
          changeDirection('RIGHT')
        } else {
          changeDirection('LEFT')
        }
      }
    } else {
      // Vertical swipe
      if (Math.abs(deltaY) > minSwipeDistance) {
        if (deltaY > 0) {
          changeDirection('DOWN')
        } else {
          changeDirection('UP')
        }
      }
    }

    touchStartRef.current = null
  }, [gameOver, gameStarted, changeDirection])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [handleKeyPress])

  const checkCollision = (newPos: Position): boolean => {
    // Check wall collision
    if (newPos.x < 0 || newPos.x >= GRID_SIZE || newPos.y < 0 || newPos.y >= GRID_SIZE) {
      return true
    }

    // Check trail collision
    return trail.some(pos => pos.x === newPos.x && pos.y === newPos.y)
  }

  const moveCycle = useCallback(() => {
    if (gameOver) return

    setCycle(prevCycle => {
      const dir = directionRef.current
      let newPos: Position

      switch (dir) {
        case 'UP':
          newPos = { x: prevCycle.x, y: prevCycle.y - 1 }
          break
        case 'DOWN':
          newPos = { x: prevCycle.x, y: prevCycle.y + 1 }
          break
        case 'LEFT':
          newPos = { x: prevCycle.x - 1, y: prevCycle.y }
          break
        case 'RIGHT':
          newPos = { x: prevCycle.x + 1, y: prevCycle.y }
          break
      }

      if (checkCollision(newPos)) {
        setGameOver(true)
        return prevCycle
      }

      // Update trail
      setTrail(prevTrail => [...prevTrail, prevCycle])
      setScore(prev => prev + 1)

      // Increase speed slightly every 50 points
      if ((score + 1) % 50 === 0) {
        setSpeed(prev => Math.max(80, prev - 10))
      }

      return newPos
    })
  }, [gameOver, trail, score])

  useEffect(() => {
    if (gameOver || !gameStarted) {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
      return
    }

    gameLoopRef.current = window.setInterval(moveCycle, speed)

    return () => {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }
  }, [moveCycle, speed, gameOver, gameStarted])

  const fetchLeaderboard = useCallback(async () => {
    setLoadingLeaderboard(true)
    
    // Always use relative path - Vite proxy or vercel dev will handle routing
    const apiUrl = '/api/scores'
    
    try {
      console.log('🔍 Fetching leaderboard from:', apiUrl)
      const response = await fetch(`${apiUrl}?limit=10`, {
        // Add credentials for CORS if needed
        credentials: 'omit',
      })
      
      console.log('📡 Response status:', response.status, response.statusText)
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()))
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ API error response:', errorText.substring(0, 200))
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      // Check if response is actually JSON before parsing
      const contentType = response.headers.get('content-type')
      console.log('📡 Content-Type:', contentType)
      
      if (!contentType || !contentType.includes('application/json')) {
        // Clone response to read text without consuming body
        const clonedResponse = response.clone()
        const text = await clonedResponse.text()
        console.warn('⚠️ API returned non-JSON response. First 200 chars:', text.substring(0, 200))
        throw new Error('Response is not JSON')
      }
      
      // Try to parse JSON
      try {
        const data = await response.json()
        console.log('✅ Successfully fetched leaderboard:', data.leaderboard?.length || 0, 'entries')
        // Sort by score high to low (ensure correct order)
        const sorted = (data.leaderboard || []).sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.score - a.score)
        setLeaderboard(sorted)
      } catch (parseError) {
        console.error('❌ Failed to parse JSON response:', parseError)
        throw new Error('Invalid JSON response')
      }
    } catch (error) {
      console.error('❌ Failed to fetch leaderboard:', error)
      
      // In dev mode, show helpful troubleshooting
      if (import.meta.env.DEV) {
        console.warn('⚠️ Local dev: API endpoint not available.')
        console.warn('   Solutions:')
        console.warn('   1. Run `vercel dev` (recommended) - runs API locally')
        console.warn('   2. Or use `vite dev` with vercel dev running on port 3000')
        console.warn('   3. Make sure REDIS_URL is set in .env.local for local API')
        console.warn('   Showing empty leaderboard for now.')
      }
      
      // Show empty leaderboard on any error
      setLeaderboard([])
    } finally {
      setLoadingLeaderboard(false)
    }
  }, [])

  // Helper to get current timezone/locale (always fresh, doesn't rely on state)
  const getCurrentLocation = useCallback(() => {
    try {
      const resolvedOptions = Intl.DateTimeFormat().resolvedOptions()
      const timezone = resolvedOptions.timeZone
      const locale = resolvedOptions.locale || navigator.language
      
      if (timezone && locale) {
        return { timezone, locale }
      } else if (timezone) {
        return { timezone, locale: navigator.language || 'en' }
      } else if (locale) {
        return { locale }
      }
    } catch (error) {
      console.error('❌ Error getting timezone/locale:', error)
    }
    
    // Final fallback
    try {
      const locale = navigator.language || 'en'
      console.warn('⚠️ Using locale fallback only:', locale)
      return { locale }
    } catch (e) {
      console.error('❌ Could not get locale fallback:', e)
      return null
    }
  }, [])

  const submitScore = useCallback(async (finalScore: number, name?: string) => {
    if (scoreSubmitted) return

    // Get timezone directly (don't rely on state which might be null)
    const currentLocation = getCurrentLocation()
    const timezone = currentLocation?.timezone || undefined
    console.log('🔍 Getting timezone at submission time:', timezone)
    console.log('🔍 Full location object:', currentLocation)

    // In local development, don't save to database but show message
    if (import.meta.env.DEV) {
      console.log('⚠️ Local development: Score will NOT be saved to database')
      setScoreSubmitted(true)
      // Don't refresh leaderboard since we didn't save anything
      return
    }

    try {
      console.log('Submitting score with timezone:', { 
        score: finalScore, 
        playerName: name, 
        hasTimezone: !!timezone,
        timezone: timezone 
      })
      
      // Ensure timezone is included if it exists
      const requestBody: {
        score: number
        playerName: string
        timezone?: string
      } = {
        score: finalScore,
        playerName: name || 'Anonymous',
      }
      
      // Only add timezone if it exists
      if (timezone) {
        requestBody.timezone = timezone
      }
      
      console.log('Request body being sent:', JSON.stringify(requestBody, null, 2))
      console.log('Timezone:', timezone)
      console.log('Request body includes timezone:', 'timezone' in requestBody)
      
      const response = await fetch('/api/scores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (response.ok) {
        setScoreSubmitted(true)
        // Refresh leaderboard after submitting
        await fetchLeaderboard()
      } else {
        const errorText = await response.text()
        console.error('Failed to submit score. Response:', response.status, errorText)
      }
    } catch (error) {
      console.error('Failed to submit score:', error)
    }
  }, [scoreSubmitted, fetchLeaderboard, getCurrentLocation])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  const startGame = () => {
    setGameStarted(true)
  }

  const resetGame = () => {
    setCycle({ x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) })
    directionRef.current = 'RIGHT'
    setTrail([])
    setGameOver(false)
    setGameStarted(false)
    setScore(0)
    setSpeed(INITIAL_SPEED)
    setScoreSubmitted(false)
  }

  return (
    <div className="game-container">
      <div className="game-header">
        <Link to="/" className="game-back-link">← Back to Metrics</Link>
        <h1 className="game-title">LIGHT CYCLE</h1>
        <div className="game-stats">
          <div className="game-stat">Score: {score}</div>
          <div className="game-stat">Speed: {Math.round((INITIAL_SPEED / speed) * 100)}%</div>
        </div>
      </div>

      <div className="game-board-container">
        <div 
          className="game-board"
          style={{
            gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
            gridTemplateRows: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
            const x = index % GRID_SIZE
            const y = Math.floor(index / GRID_SIZE)
            const isCycle = cycle.x === x && cycle.y === y
            const isTrail = trail.some(pos => pos.x === x && pos.y === y)

            return (
              <div
                key={index}
                className={`game-cell ${isCycle ? 'game-cell-cycle' : ''} ${isTrail ? 'game-cell-trail' : ''}`}
                data-direction={isCycle ? directionRef.current : undefined}
              >
                {isCycle && gameStarted && !gameOver && (
                  <img 
                    src="/lightcycle-icon.png" 
                    alt="Light Cycle"
                    className="lightcycle-icon"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${
                        directionRef.current === 'UP' ? '0deg' :
                        directionRef.current === 'RIGHT' ? '90deg' :
                        directionRef.current === 'DOWN' ? '180deg' :
                        '-90deg'
                      })`
                    }}
                    onError={(e) => {
                      // Hide the image if it fails to load
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {!gameStarted && !gameOver && (
          <div className="game-overlay">
            <div className="game-over-content">
              <h2>LIGHT CYCLE</h2>
              <p>Use arrow keys or swipe to control your cycle</p>
              <p>Avoid walls and your own trail!</p>
              <button onClick={startGame} className="game-restart-button">
                START
              </button>
            </div>
          </div>
        )}

        {gameOver && (
          <div className="game-overlay">
            <div className="game-over-content">
              <h2>GAME OVER</h2>
              <p className="final-score">Final Score: {score}</p>
              
              {!scoreSubmitted && (
                <>
                  <div className="player-name-input">
                    <input
                      type="text"
                      placeholder="Enter your name (optional)"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      maxLength={20}
                      className="player-name-field"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !scoreSubmitted) {
                          submitScore(score, playerName || undefined)
                        }
                      }}
                    />
                  </div>
                  <button 
                    onClick={() => !scoreSubmitted && submitScore(score, playerName || undefined)}
                    className="game-submit-score-button"
                    disabled={scoreSubmitted}
                  >
                    Submit Score
                  </button>
                </>
              )}

              {scoreSubmitted && (
                <>
                  {import.meta.env.DEV ? (
                    <p className="score-submitted dev-warning">
                      ⚠️ Local build: Scores will NOT be saved to the database
                    </p>
                  ) : (
                    <p className="score-submitted">✓ Score submitted!</p>
                  )}
                </>
              )}

              <button onClick={resetGame} className="game-restart-button">
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>


      {!gameOver && (
        <div className="game-controls">
          <div className="game-controls-row">
            <button 
              className="game-control-button"
              onClick={() => changeDirection('UP')}
              aria-label="Up"
            >
              ↑
            </button>
          </div>
          <div className="game-controls-row">
            <button 
              className="game-control-button"
              onClick={() => changeDirection('LEFT')}
              aria-label="Left"
            >
              ←
            </button>
            <div className="game-control-spacer"></div>
            <button 
              className="game-control-button"
              onClick={() => changeDirection('RIGHT')}
              aria-label="Right"
            >
              →
            </button>
          </div>
          <div className="game-controls-row">
            <button 
              className="game-control-button"
              onClick={() => changeDirection('DOWN')}
              aria-label="Down"
            >
              ↓
            </button>
          </div>
        </div>
      )}

      <div className="leaderboard-section">
        <h3 className="leaderboard-title">LEADERBOARD</h3>
        {loadingLeaderboard ? (
          <p className="leaderboard-loading">Loading...</p>
        ) : leaderboard.length === 0 ? (
          <p className="leaderboard-empty">No scores yet. Be the first!</p>
        ) : (
          <div className="leaderboard-list">
            {leaderboard.map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`} className="leaderboard-entry">
                <span className="leaderboard-rank">#{index + 1}</span>
                <div className="leaderboard-player-info">
                  <span className="leaderboard-name">{entry.playerName || 'Anonymous'}</span>
                  {((entry.date || entry.time) || entry.timezone) && (
                    <span className="leaderboard-date">
                      {entry.date && entry.time && `${entry.date} ${entry.time}`}
                      {entry.timezone && (
                        <>
                          {entry.date || entry.time ? ' • ' : ''}
                          📍 {entry.timezone.replace(/_/g, ' ')}
                        </>
                      )}
                    </span>
                  )}
                </div>
                <span className="leaderboard-score">{entry.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

