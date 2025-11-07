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
    if (gameOver) return

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
  }, [gameOver])

  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    if (gameOver) return

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
  }, [gameOver, changeDirection])

  // Touch handlers for swipe gestures
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (gameOver) return
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, [gameOver])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (gameOver || !touchStartRef.current) return
    
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
  }, [gameOver, changeDirection])

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
    if (gameOver) {
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
  }, [moveCycle, speed, gameOver])

  const fetchLeaderboard = useCallback(async () => {
    // Skip in local development - Vercel serverless functions only work when deployed
    if (import.meta.env.DEV) {
      console.log('Skipping leaderboard fetch in local development')
      // Use localStorage as fallback for local dev
      try {
        const localScores = localStorage.getItem('lightCycleLeaderboard')
        if (localScores) {
          const parsed = JSON.parse(localScores)
          setLeaderboard(parsed.sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.score - a.score).slice(0, 10))
        }
      } catch {
        // Ignore localStorage errors
      }
      setLoadingLeaderboard(false)
      return
    }

    setLoadingLeaderboard(true)
    try {
      const response = await fetch('/api/scores?limit=10')
      if (response.ok) {
        const data = await response.json()
        setLeaderboard(data.leaderboard || [])
      }
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error)
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

    // Skip in local development - use localStorage as fallback
    if (import.meta.env.DEV) {
      console.log('Skipping score submission in local development, using localStorage')
      try {
        const localScores = localStorage.getItem('lightCycleLeaderboard')
        const scores: LeaderboardEntry[] = localScores ? JSON.parse(localScores) : []
        
        // Remove old entries with same name
        if (name && name.trim() !== '' && name !== 'Anonymous') {
          const filtered = scores.filter(e => e.playerName !== name)
          scores.length = 0
          scores.push(...filtered)
        }
        
        // Add date and time
        const now = new Date()
        const date = now.toISOString().split('T')[0]
        const time = now.toTimeString().split(' ')[0]
        
        scores.push({
          score: finalScore,
          timestamp: Date.now(),
          playerName: name || 'Anonymous',
          date,
          time,
          timezone,
        })
        // Keep only top 100 scores
        scores.sort((a, b) => b.score - a.score)
        localStorage.setItem('lightCycleLeaderboard', JSON.stringify(scores.slice(0, 100)))
        setScoreSubmitted(true)
        // Refresh leaderboard
        await fetchLeaderboard()
      } catch (error) {
        console.error('Failed to save score to localStorage:', error)
      }
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

  const resetGame = () => {
    setCycle({ x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) })
    directionRef.current = 'RIGHT'
    setTrail([])
    setGameOver(false)
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
              />
            )
          })}
        </div>

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
                <p className="score-submitted">✓ Score submitted!</p>
              )}

              <button onClick={resetGame} className="game-restart-button">
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="game-instructions">
        {isMobile ? (
          <>
            <p>Swipe or use buttons to control your light cycle</p>
            <p>Avoid walls and your own trail!</p>
          </>
        ) : (
          <>
            <p>Use arrow keys to control your light cycle</p>
            <p>Avoid walls and your own trail!</p>
          </>
        )}
      </div>

      {isMobile && !gameOver && (
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
                  {(entry.date || entry.time) && (
                    <span className="leaderboard-date">
                      {entry.date} {entry.time}
                    </span>
                  )}
                  {entry.timezone && (
                    <span className="leaderboard-location">
                      📍 {entry.timezone.replace(/_/g, ' ')}
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

