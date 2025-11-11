import type { VercelRequest, VercelResponse } from '@vercel/node'
import { 
  logError, 
  logWarning, 
  logInfo, 
  createErrorResponse, 
  generateRequestId,
  type ErrorLogContext 
} from './errorLogger'

interface ScoreEntry {
  score: number
  timestamp: number
  playerName?: string
  date: string // ISO date string
  time: string // Time string (HH:MM:SS)
  timezone?: string
}

// In-memory fallback store (resets on deployment)
// For production, use Vercel KV (see instructions below)
let scoreStore: ScoreEntry[] = []

// Helper to get Redis client (Vercel KV or external Redis)
async function getRedisClient() {
  try {
    // First, try Vercel KV (preferred)
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const kv = await import('@vercel/kv')
      return { type: 'vercel-kv', client: kv.kv }
    }
    
    // Fallback to external Redis via REDIS_URL
    if (process.env.REDIS_URL) {
      const Redis = await import('ioredis')
      const redis = new Redis.default(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 10000,
        retryStrategy: (times) => {
          if (times > 3) {
            return null // Stop retrying
          }
          return Math.min(times * 200, 2000)
        },
        // Important for serverless: connection settings
        keepAlive: 30000,
      })
      
      try {
        await redis.connect()
        return { type: 'redis', client: redis }
      } catch (connectError) {
        console.error('Failed to connect to Redis:', connectError)
        throw connectError
      }
    }
    
    return null
  } catch (error) {
    console.error('Error initializing Redis client:', error)
    return null
  }
}

// Helper to format date and time
function getDateAndTime(): { date: string; time: string } {
  const now = new Date()
  const date = now.toISOString().split('T')[0] // YYYY-MM-DD
  const time = now.toTimeString().split(' ')[0] // HH:MM:SS
  return { date, time }
}

// Helper to save scores to Redis or fallback
async function saveScore(score: number, playerName?: string, timezone?: string): Promise<void> {
  const redisClient = await getRedisClient()
  const { date, time } = getDateAndTime()
  const entry: ScoreEntry = {
    score,
    timestamp: Date.now(),
    playerName: playerName || 'Anonymous',
    date,
    time,
    timezone: timezone || undefined,
  }
  
  console.log('Entry being saved:', JSON.stringify(entry, null, 2))
  console.log('Timezone in entry:', entry.timezone)

  if (redisClient) {
    try {
      const { type, client } = redisClient
      
      // If player has a name, check for existing entries with the same name and remove them
      if (playerName && playerName.trim() !== '' && playerName !== 'Anonymous') {
        // Get all score IDs from the leaderboard
        let allScoreIds: string[] = []
        if (type === 'vercel-kv') {
          allScoreIds = await client.zrange('leaderboard', 0, -1) as string[]
        } else {
          allScoreIds = await client.zrange('leaderboard', 0, -1) as string[]
        }
        
        // Check each entry and remove if it has the same player name
        for (const scoreId of allScoreIds) {
          try {
            let existingEntry: ScoreEntry | null = null
            if (type === 'vercel-kv') {
              existingEntry = await client.get(scoreId) as ScoreEntry | null
            } else {
              const data = await client.get(scoreId)
              existingEntry = data ? JSON.parse(data as string) : null
            }
            
            if (existingEntry && existingEntry.playerName === playerName) {
              // Remove from sorted set
              await client.zrem('leaderboard', scoreId)
              // Delete the entry
              await client.del(scoreId)
            }
          } catch (err) {
            // Ignore errors for individual entries
            console.error('Error checking entry:', err)
          }
        }
      }

      // Store each score with a unique key
      const scoreId = `score:${Date.now()}:${Math.random().toString(36).substring(7)}`
      
      if (type === 'vercel-kv') {
        await client.set(scoreId, entry)
        await client.zadd('leaderboard', { score: score, member: scoreId })
        await client.zremrangebyrank('leaderboard', 0, -1001)
      } else {
        // External Redis - need to JSON stringify
        await client.set(scoreId, JSON.stringify(entry))
        await client.zadd('leaderboard', score, scoreId)
        // Keep only top 1000 scores (remove from index 0 to -1001, keeping last 1000)
        const totalScores = await client.zcard('leaderboard')
        if (totalScores > 1000) {
          await client.zremrangebyrank('leaderboard', 0, totalScores - 1001)
        }
      }
    } catch (error) {
      console.error('Error saving to Redis, falling back to memory:', error)
      // Fallback to in-memory if Redis fails
      // Remove old entries with same name
      if (playerName && playerName.trim() !== '' && playerName !== 'Anonymous') {
        scoreStore = scoreStore.filter(e => e.playerName !== playerName)
      }
      scoreStore.push(entry)
      scoreStore.sort((a, b) => b.score - a.score)
      scoreStore = scoreStore.slice(0, 100)
    }
  } else {
    // Fallback to in-memory store
    // Remove old entries with same name
    if (playerName && playerName.trim() !== '' && playerName !== 'Anonymous') {
      scoreStore = scoreStore.filter(e => e.playerName !== playerName)
    }
    scoreStore.push(entry)
    // Keep only top 100 scores in memory
    scoreStore.sort((a, b) => b.score - a.score)
    scoreStore = scoreStore.slice(0, 100)
  }
}

// Helper to get leaderboard
async function getLeaderboard(limit: number = 10): Promise<ScoreEntry[]> {
  const redisClient = await getRedisClient()

  if (redisClient) {
    try {
      const { type, client } = redisClient
      
      // Get top scores from sorted set (reverse order = highest first)
      let scoreIds: string[] = []
      if (type === 'vercel-kv') {
        scoreIds = await client.zrange('leaderboard', 0, limit - 1, { rev: true, withScores: false }) as string[]
      } else {
        scoreIds = await client.zrevrange('leaderboard', 0, limit - 1) as string[]
      }
      
      const scores: ScoreEntry[] = []
      
      // Fetch all score entries in parallel
      const entries = await Promise.all(
        scoreIds.map(async (scoreId) => {
          try {
            if (type === 'vercel-kv') {
              return await client.get(scoreId) as ScoreEntry | null
            } else {
              const data = await client.get(scoreId)
              return data ? JSON.parse(data as string) as ScoreEntry : null
            }
          } catch {
            return null
          }
        })
      )
      
      // Filter out null entries and sort by score (in case of any inconsistencies)
      for (const entry of entries) {
        if (entry) {
          scores.push(entry)
        }
      }
      
      return scores.sort((a, b) => b.score - a.score).slice(0, limit)
    } catch (error) {
      console.error('Error fetching from Redis, falling back to memory:', error)
      // Fallback to in-memory store
      return scoreStore
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
    }
  } else {
    // Fallback to in-memory store
    return scoreStore
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Generate unique request ID for tracking
  const requestId = generateRequestId()
  
  // Create context for logging
  const context: ErrorLogContext = {
    endpoint: '/api/scores',
    method: req.method || 'UNKNOWN',
    userAgent: req.headers['user-agent'],
    ip: req.headers['x-forwarded-for']?.toString().split(',')[0] || req.headers['x-real-ip']?.toString() || 'unknown',
  }
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  // Add request ID to response headers for tracking
  res.setHeader('X-Request-ID', requestId)

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'POST') {
    try {
      const { score, playerName, timezone } = req.body

      // Input validation
      if (typeof score !== 'number' || score < 0) {
        logWarning('Invalid score submitted', context, requestId)
        return res.status(400).json({ 
          error: 'Invalid input',
          message: 'Score must be a positive number',
          requestId 
        })
      }

      // Log the operation (structured logging)
      logInfo('Score submission attempt', context, requestId, {
        hasPlayerName: !!playerName,
        hasTimezone: !!timezone,
        score,
      })

      await saveScore(score, playerName, timezone)
      
      logInfo('Score saved successfully', context, requestId, { score, playerName: playerName || 'Anonymous' })

      return res.status(200).json({ success: true, requestId })
    } catch (error) {
      // Log detailed error server-side
      logError(error, { ...context, operation: 'saveScore' }, requestId)
      
      // Return safe error response to client
      const errorResponse = createErrorResponse(
        error,
        requestId,
        'Failed to save score. Please try again later.'
      )
      
      return res.status(500).json(errorResponse)
    }
  }

  if (req.method === 'GET') {
    try {
      const limit = parseInt(req.query.limit as string) || 10
      const sanitizedLimit = Math.min(Math.max(1, limit), 100)
      
      logInfo('Leaderboard fetch', context, requestId, { limit: sanitizedLimit })
      
      const leaderboard = await getLeaderboard(sanitizedLimit)

      return res.status(200).json({ leaderboard, requestId })
    } catch (error) {
      // Log detailed error server-side
      logError(error, { ...context, operation: 'getLeaderboard' }, requestId)
      
      // Return safe error response to client
      const errorResponse = createErrorResponse(
        error,
        requestId,
        'Failed to fetch leaderboard. Please try again later.'
      )
      
      return res.status(500).json(errorResponse)
    }
  }

  logWarning('Method not allowed', context, requestId)
  return res.status(405).json({ 
    error: 'Method not allowed',
    message: `Method ${req.method} is not supported for this endpoint`,
    requestId 
  })
}

