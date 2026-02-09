import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  setCorsHeaders,
  setSecurityHeaders,
  validatePlayerName,
  validateTimezone,
  validateScore,
  validateRequestSize,
  checkRateLimit,
  getClientIp,
} from './security'

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
      console.log('[getRedisClient] Using Vercel KV')
      const kv = await import('@vercel/kv')
      return { type: 'vercel-kv', client: kv.kv }
    }
    
    // Fallback to external Redis via REDIS_URL
    if (process.env.REDIS_URL) {
      console.log('[getRedisClient] Using external Redis (REDIS_URL provided)')
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
        console.log('[getRedisClient] Successfully connected to external Redis')
        return { type: 'redis', client: redis }
      } catch (connectError) {
        console.error('[getRedisClient] Failed to connect to Redis:', connectError)
        throw connectError
      }
    }
    
    console.warn('[getRedisClient] No Redis configuration found (neither KV_REST_API_URL nor REDIS_URL)')
    return null
  } catch (error) {
    console.error('[getRedisClient] Error initializing Redis client:', error)
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
async function saveScore(score: number, playerName: string, timezone?: string): Promise<void> {
  const redisClient = await getRedisClient()
  const { date, time } = getDateAndTime()
  const entry: ScoreEntry = {
    score,
    timestamp: Date.now(),
    playerName, // Already validated
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
      // Normalize player name for comparison (trim and lowercase)
      const normalizedPlayerName = playerName?.trim()
      if (normalizedPlayerName && normalizedPlayerName !== '' && normalizedPlayerName !== 'Anonymous') {
        // Get all score IDs from the leaderboard
        let allScoreIds: string[] = []
        if (type === 'vercel-kv') {
          allScoreIds = await client.zrange('leaderboard', 0, -1) as string[]
        } else {
          // External Redis (ioredis)
          allScoreIds = await (client as any).zrange('leaderboard', 0, -1) as string[]
        }
        
        // Check each entry and remove if it has the same player name (case-insensitive, trimmed)
        for (const scoreId of allScoreIds) {
          try {
            let existingEntry: ScoreEntry | null = null
            if (type === 'vercel-kv') {
              existingEntry = await client.get(scoreId) as ScoreEntry | null
            } else {
              const data = await client.get(scoreId)
              existingEntry = data ? JSON.parse(data as string) : null
            }
            
            // Compare normalized names (case-insensitive, trimmed)
            const existingName = existingEntry?.playerName?.trim() || ''
            if (existingEntry && existingName.toLowerCase() === normalizedPlayerName.toLowerCase()) {
              console.log(`[saveScore] Removing duplicate entry for player "${normalizedPlayerName}": ${scoreId}`)
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
        // Vercel KV accepts JSON-serializable values directly
        await client.set(scoreId, entry as any)
        // Vercel KV zadd syntax: zadd(key, { score, member })
        await client.zadd('leaderboard', { score, member: scoreId } as any)
        // Keep only top 1000 scores
        const totalScores = await client.zcard('leaderboard')
        if (totalScores > 1000) {
          await client.zremrangebyrank('leaderboard', 0, totalScores - 1001)
        }
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
      // Remove old entries with same name (case-insensitive, trimmed)
      const normalizedPlayerName = playerName?.trim()
      if (normalizedPlayerName && normalizedPlayerName !== '' && normalizedPlayerName !== 'Anonymous') {
        scoreStore = scoreStore.filter(e => {
          const existingName = (e.playerName || '').trim()
          return existingName.toLowerCase() !== normalizedPlayerName.toLowerCase()
        })
      }
      scoreStore.push(entry)
      scoreStore.sort((a, b) => b.score - a.score)
      scoreStore = scoreStore.slice(0, 100)
    }
  } else {
    // Fallback to in-memory store
    // Remove old entries with same name (case-insensitive, trimmed)
    const normalizedPlayerName = playerName?.trim()
    if (normalizedPlayerName && normalizedPlayerName !== '' && normalizedPlayerName !== 'Anonymous') {
      scoreStore = scoreStore.filter(e => {
        const existingName = (e.playerName || '').trim()
        return existingName.toLowerCase() !== normalizedPlayerName.toLowerCase()
      })
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
      
      console.log(`[getLeaderboard] Using ${type} client, limit: ${limit}`)
      
      // Get top scores from sorted set (reverse order = highest first)
      let scoreIds: string[] = []
      if (type === 'vercel-kv') {
        // Vercel KV: Get all scores, then sort and take top N
        // Sorted sets are ordered by score, so we need to get all and reverse
        const totalScores = await client.zcard('leaderboard')
        if (totalScores > 0) {
          // Get all scores (they come in ascending order by score)
          const allScoreIds = await client.zrange('leaderboard', 0, -1) as string[]
          // Reverse to get highest scores first, then take top N
          scoreIds = allScoreIds.reverse().slice(0, limit)
        }
      } else {
        // External Redis (ioredis) - use zrevrange for reverse order
        scoreIds = await (client as any).zrevrange('leaderboard', 0, limit - 1) as string[]
      }
      
      console.log(`[getLeaderboard] Found ${scoreIds.length} score IDs in leaderboard`)
      
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
          } catch (err) {
            console.error(`[getLeaderboard] Error fetching entry ${scoreId}:`, err)
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
      
      // Deduplicate: keep only the highest score for each player name
      // This handles existing duplicates in the database
      const playerMap = new Map<string, ScoreEntry>()
      for (const entry of scores) {
        const normalizedName = (entry.playerName || 'Anonymous').trim().toLowerCase()
        const existing = playerMap.get(normalizedName)
        
        // Keep the entry with the higher score, or the newer one if scores are equal
        if (!existing || entry.score > existing.score || 
            (entry.score === existing.score && entry.timestamp > existing.timestamp)) {
          playerMap.set(normalizedName, entry)
        }
      }
      
      // Convert back to array and sort by score
      const deduplicatedScores = Array.from(playerMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
      
      if (deduplicatedScores.length < scores.length) {
        console.log(`[getLeaderboard] Deduplicated ${scores.length} entries to ${deduplicatedScores.length} unique players`)
      }
      
      console.log(`[getLeaderboard] Returning ${deduplicatedScores.length} valid entries`)
      return deduplicatedScores
    } catch (error) {
      console.error('[getLeaderboard] Error fetching from Redis, falling back to memory:', error)
      console.error('[getLeaderboard] Error details:', error instanceof Error ? error.message : String(error))
      // Fallback to in-memory store with deduplication
      const playerMap = new Map<string, ScoreEntry>()
      for (const entry of scoreStore) {
        const normalizedName = (entry.playerName || 'Anonymous').trim().toLowerCase()
        const existing = playerMap.get(normalizedName)
        if (!existing || entry.score > existing.score || 
            (entry.score === existing.score && entry.timestamp > existing.timestamp)) {
          playerMap.set(normalizedName, entry)
        }
      }
      return Array.from(playerMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
    }
  } else {
    console.warn('[getLeaderboard] No Redis client available, using in-memory store (empty after deployment)')
    // Fallback to in-memory store with deduplication
    const playerMap = new Map<string, ScoreEntry>()
    for (const entry of scoreStore) {
      const normalizedName = (entry.playerName || 'Anonymous').trim().toLowerCase()
      const existing = playerMap.get(normalizedName)
      if (!existing || entry.score > existing.score || 
          (entry.score === existing.score && entry.timestamp > existing.timestamp)) {
        playerMap.set(normalizedName, entry)
      }
    }
    return Array.from(playerMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Top-level error handler to catch any initialization errors
  try {
    // Set security headers
    setSecurityHeaders(res)
    
    // Set CORS headers (restricted to allowed origins)
    setCorsHeaders(req, res)

    if (req.method === 'OPTIONS') {
      return res.status(200).end()
    }

    if (req.method === 'POST') {
      try {
        // Rate limiting: 10 requests per minute per IP
        const clientIp = getClientIp(req)
        if (!checkRateLimit(clientIp, 10, 60000)) {
          console.warn('[scores] Rate limit exceeded for IP:', clientIp)
          return res.status(429).json({
            error: 'Too many requests',
            message: 'Rate limit exceeded. Please try again later.'
          })
        }

        // Validate request size (max 10KB)
        const sizeValidation = validateRequestSize(req.headers['content-length'], 10240)
        if (!sizeValidation.valid) {
          console.warn('[scores] Request too large:', req.headers['content-length'])
          return res.status(413).json({
            error: 'Request too large',
            message: sizeValidation.error || 'Request body exceeds maximum size'
          })
        }

        const { score, playerName, timezone } = req.body

        // Validate score
        const scoreValidation = validateScore(score)
        if (!scoreValidation.valid) {
          console.warn('[scores] Invalid score submitted:', score, scoreValidation.error)
          return res.status(400).json({ 
            error: 'Invalid input',
            message: scoreValidation.error || 'Invalid score value'
          })
        }

        // Validate and sanitize player name
        const validatedPlayerName = validatePlayerName(playerName)

        // Validate timezone
        const validatedTimezone = validateTimezone(timezone)

        console.log('[scores] Score submission attempt:', {
          hasPlayerName: !!validatedPlayerName && validatedPlayerName !== 'Anonymous',
          hasTimezone: !!validatedTimezone,
          score: scoreValidation.value,
        })

        await saveScore(scoreValidation.value!, validatedPlayerName, validatedTimezone)
        
        console.log('[scores] Score saved successfully:', { score: scoreValidation.value, playerName: validatedPlayerName })

        return res.status(200).json({ success: true })
      } catch (error) {
        console.error('[scores] Error saving score:', error)
        
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to save score. Please try again later.'
        })
      }
    }

    if (req.method === 'GET') {
      try {
        const limit = parseInt(req.query.limit as string) || 10
        const sanitizedLimit = Math.min(Math.max(1, limit), 100)
        
        console.log('[scores] Leaderboard fetch:', { limit: sanitizedLimit })
        
        const leaderboard = await getLeaderboard(sanitizedLimit)

        return res.status(200).json({ leaderboard })
      } catch (error) {
        console.error('[scores] Error fetching leaderboard:', error)
        
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to fetch leaderboard. Please try again later.'
        })
      }
    }

    console.warn('[scores] Method not allowed:', req.method)
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: `Method ${req.method} is not supported for this endpoint`
    })
  } catch (topLevelError) {
    // Catch any errors that occur before we can set up proper error handling
    console.error('[scores] Top-level error:', topLevelError)
    const errorMessage = topLevelError instanceof Error ? topLevelError.message : String(topLevelError)
    
    // Try to set headers even on error
    try {
      setCorsHeaders(req, res)
      setSecurityHeaders(res)
      res.setHeader('Content-Type', 'application/json')
    } catch {}
    
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      ...(process.env.NODE_ENV === 'development' && { details: errorMessage })
    })
  }
}

