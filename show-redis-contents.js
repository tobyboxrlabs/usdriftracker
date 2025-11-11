import Redis from 'ioredis'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.development.local') })

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  console.error('❌ REDIS_URL not found in environment variables')
  process.exit(1)
}

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
})

async function showDatabaseContents() {
  try {
    await redis.connect()
    console.log('🔌 Connected to Redis\n')

    // Get all keys
    const allKeys = await redis.keys('*')
    
    if (allKeys.length === 0) {
      console.log('📭 Database is empty - no keys found')
      console.log('\n💡 This is normal if no scores have been submitted yet.')
      console.log('   Once you play the game and submit scores, they will appear here.')
      try {
        await redis.quit()
      } catch (e) {
        // Ignore quit errors
      }
      return
    }

    console.log(`📊 Found ${allKeys.length} key(s) in database\n`)
    console.log('═'.repeat(80))

    // Group keys by type
    const scoreKeys = allKeys.filter(k => k.startsWith('score:'))
    const leaderboardKey = allKeys.find(k => k === 'leaderboard')
    const otherKeys = allKeys.filter(k => !k.startsWith('score:') && k !== 'leaderboard')

    // Show leaderboard sorted set
    if (leaderboardKey) {
      console.log('\n🏆 LEADERBOARD (Sorted Set)')
      console.log('─'.repeat(80))
      const leaderboardSize = await redis.zcard('leaderboard')
      console.log(`   Total entries: ${leaderboardSize}`)
      
      if (leaderboardSize > 0) {
        const allScoreIds = await redis.zrevrange('leaderboard', 0, -1)
        console.log(`   Score IDs in leaderboard: ${allScoreIds.length}`)
        console.log('\n   Top 10 scores:')
        console.log('   ' + '─'.repeat(78))
        
        const top10 = allScoreIds.slice(0, 10)
        for (let i = 0; i < top10.length; i++) {
          const scoreId = top10[i]
          const score = await redis.zscore('leaderboard', scoreId)
          const entryData = await redis.get(scoreId)
          
          if (entryData) {
            try {
              const entry = JSON.parse(entryData)
              console.log(`   ${i + 1}. ${entry.playerName || 'Anonymous'}`)
              console.log(`      Score: ${entry.score.toLocaleString()}`)
              console.log(`      Date: ${entry.date} ${entry.time}`)
              if (entry.timezone) {
                console.log(`      Timezone: 📍 ${entry.timezone.replace(/_/g, ' ')}`)
              } else if (entry.location && entry.location.timezone) {
                // Legacy format support
                console.log(`      Timezone: 📍 ${entry.location.timezone.replace(/_/g, ' ')}`)
              }
              console.log(`      Key: ${scoreId}`)
              console.log(`      Sorted Set Score: ${score}`)
              console.log()
            } catch (e) {
              console.log(`   ${i + 1}. Key: ${scoreId} (parse error)`)
              console.log(`      Raw data: ${entryData.substring(0, 100)}...`)
              console.log()
            }
          } else {
            console.log(`   ${i + 1}. Key: ${scoreId} (no data found)`)
            console.log()
          }
        }
        
        if (leaderboardSize > 10) {
          console.log(`   ... and ${leaderboardSize - 10} more entries`)
        }
      }
    }

    // Show all score entries
    if (scoreKeys.length > 0) {
      console.log('\n📝 SCORE ENTRIES')
      console.log('─'.repeat(80))
      console.log(`   Total score entries: ${scoreKeys.length}\n`)
      
      for (let i = 0; i < Math.min(scoreKeys.length, 20); i++) {
        const key = scoreKeys[i]
        const data = await redis.get(key)
        
        if (data) {
          try {
            const entry = JSON.parse(data)
            console.log(`   Key: ${key}`)
            console.log(`   └─ Player: ${entry.playerName || 'Anonymous'}`)
            console.log(`   └─ Score: ${entry.score.toLocaleString()}`)
            console.log(`   └─ Date: ${entry.date} ${entry.time}`)
            if (entry.timezone) {
              console.log(`   └─ Timezone: 📍 ${entry.timezone.replace(/_/g, ' ')}`)
            } else if (entry.location && entry.location.timezone) {
              // Legacy format support
              console.log(`   └─ Timezone: 📍 ${entry.location.timezone.replace(/_/g, ' ')}`)
            } else {
              console.log(`   └─ Timezone: (not provided)`)
            }
            console.log()
          } catch (e) {
            console.log(`   Key: ${key}`)
            console.log(`   └─ Raw data: ${data.substring(0, 100)}...`)
            console.log()
          }
        }
      }
      
      if (scoreKeys.length > 20) {
        console.log(`   ... and ${scoreKeys.length - 20} more score entries`)
      }
    }

    // Show other keys
    if (otherKeys.length > 0) {
      console.log('\n🔑 OTHER KEYS')
      console.log('─'.repeat(80))
      for (const key of otherKeys) {
        const type = await redis.type(key)
        console.log(`   ${key} (type: ${type})`)
        
        if (type === 'string') {
          const value = await redis.get(key)
          console.log(`      Value: ${value?.substring(0, 100)}${value && value.length > 100 ? '...' : ''}`)
        } else if (type === 'list') {
          const length = await redis.llen(key)
          console.log(`      List length: ${length}`)
        } else if (type === 'set') {
          const size = await redis.scard(key)
          console.log(`      Set size: ${size}`)
        } else if (type === 'zset') {
          const size = await redis.zcard(key)
          console.log(`      Sorted set size: ${size}`)
        } else if (type === 'hash') {
          const size = await redis.hlen(key)
          console.log(`      Hash size: ${size}`)
        }
        console.log()
      }
    }

    // Summary
    console.log('═'.repeat(80))
    console.log('\n📈 SUMMARY')
    console.log('─'.repeat(80))
    console.log(`   Total keys: ${allKeys.length}`)
    console.log(`   Score entries: ${scoreKeys.length}`)
    console.log(`   Leaderboard entries: ${leaderboardKey ? await redis.zcard('leaderboard') : 0}`)
    console.log(`   Other keys: ${otherKeys.length}`)
    console.log()

  } catch (error) {
    console.error('❌ Error reading database:', error)
    if (error.message) {
      console.error('   Error message:', error.message)
    }
    process.exit(1)
  } finally {
    try {
      await redis.quit()
      console.log('👋 Disconnected from Redis')
    } catch (e) {
      // Ignore quit errors
    }
  }
}

showDatabaseContents()

