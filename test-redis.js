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
  console.log('Available env vars with REDIS:', Object.keys(process.env).filter(k => k.includes('REDIS') || k.includes('KV')))
  process.exit(1)
}

console.log('🔌 Connecting to Redis...')
console.log('📍 Redis URL:', redisUrl.replace(/:[^:@]+@/, ':****@')) // Hide password

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
})

async function testRedis() {
  try {
    await redis.connect()
    console.log('✅ Connected to Redis successfully!\n')

    // Test 1: Ping
    console.log('📡 Test 1: PING')
    const pong = await redis.ping()
    console.log('   Response:', pong)
    console.log('   ✅ PING successful\n')

    // Test 2: Set a test key
    console.log('💾 Test 2: SET test key')
    await redis.set('test:connection', JSON.stringify({ 
      message: 'Hello from test script',
      timestamp: Date.now() 
    }))
    console.log('   ✅ SET successful\n')

    // Test 3: Get the test key
    console.log('📖 Test 3: GET test key')
    const testValue = await redis.get('test:connection')
    console.log('   Value:', testValue)
    console.log('   ✅ GET successful\n')

    // Test 4: Check leaderboard sorted set
    console.log('🏆 Test 4: Check leaderboard')
    const leaderboardSize = await redis.zcard('leaderboard')
    console.log('   Leaderboard entries:', leaderboardSize)
    
    if (leaderboardSize > 0) {
      const topScores = await redis.zrevrange('leaderboard', 0, 4)
      console.log('   Top 5 score IDs:', topScores)
      
      // Get actual score entries
      if (topScores.length > 0) {
        console.log('\n   📊 Top scores:')
        for (const scoreId of topScores) {
          const scoreData = await redis.get(scoreId)
          if (scoreData) {
            const entry = JSON.parse(scoreData)
            console.log(`      - ${entry.playerName || 'Anonymous'}: ${entry.score} (${entry.date} ${entry.time})`)
          }
        }
      }
    } else {
      console.log('   ℹ️  No scores in leaderboard yet')
    }
    console.log('   ✅ Leaderboard check successful\n')

    // Test 5: List all keys (limited)
    console.log('🔑 Test 5: List keys (first 10)')
    const keys = await redis.keys('*')
    console.log(`   Total keys: ${keys.length}`)
    console.log('   Sample keys:', keys.slice(0, 10))
    console.log('   ✅ Key listing successful\n')

    // Cleanup test key
    await redis.del('test:connection')
    console.log('🧹 Cleaned up test key\n')

    console.log('✅ All tests passed! Redis database is working correctly.')
    
  } catch (error) {
    console.error('❌ Error testing Redis:', error)
    if (error.message) {
      console.error('   Error message:', error.message)
    }
    process.exit(1)
  } finally {
    await redis.quit()
    console.log('👋 Disconnected from Redis')
  }
}

testRedis()

