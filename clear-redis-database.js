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

const redis = new Redis.default(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
})

async function clearDatabase() {
  try {
    await redis.connect()
    console.log('🔌 Connected to Redis\n')

    // Get all keys
    const allKeys = await redis.keys('*')
    console.log(`📊 Found ${allKeys.length} key(s) in database\n`)

    if (allKeys.length === 0) {
      console.log('✅ Database is already empty')
      await redis.quit()
      return
    }

    // Show what will be deleted
    const scoreKeys = allKeys.filter(k => k.startsWith('score:'))
    const leaderboardKey = allKeys.find(k => k === 'leaderboard')
    const otherKeys = allKeys.filter(k => !k.startsWith('score:') && k !== 'leaderboard')

    console.log('📋 Keys to delete:')
    console.log(`   - Score entries: ${scoreKeys.length}`)
    console.log(`   - Leaderboard: ${leaderboardKey ? '1' : '0'}`)
    console.log(`   - Other keys: ${otherKeys.length}`)
    console.log()

    // Delete all keys
    if (allKeys.length > 0) {
      await redis.del(...allKeys)
      console.log('✅ Deleted all keys from database')
    }

    // Verify deletion
    const remainingKeys = await redis.keys('*')
    console.log(`\n📊 Remaining keys: ${remainingKeys.length}`)
    
    if (remainingKeys.length === 0) {
      console.log('✅ Database cleared successfully!')
    } else {
      console.log('⚠️  Warning: Some keys remain:', remainingKeys)
    }

  } catch (error) {
    console.error('❌ Error clearing database:', error)
    if (error instanceof Error) {
      console.error('   Error message:', error.message)
    }
    process.exit(1)
  } finally {
    try {
      await redis.quit()
      console.log('\n👋 Disconnected from Redis')
    } catch (e) {
      // Ignore quit errors
    }
  }
}

clearDatabase()

