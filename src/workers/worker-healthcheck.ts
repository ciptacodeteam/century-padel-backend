/**
 * Health check script for worker processes
 * Checks Redis connection to ensure worker dependencies are available
 */

import { getRedisConnection } from '@/lib/redis'
import Redis from 'ioredis'

const checkHealth = async () => {
  let client: Redis | null = null
  try {
    // Check Redis connection using ioredis (same as BullMQ uses)
    const redisConnection = getRedisConnection()
    client = new Redis({
      host: redisConnection.host,
      port: redisConnection.port,
      password: redisConnection.password,
      db: redisConnection.db,
      maxRetriesPerRequest: 1,
      lazyConnect: false,
      connectTimeout: 5000,
    })

    await client.ping()
    await client.quit()

    // If we get here, Redis is healthy
    process.exit(0)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)
    console.error(`Worker health check failed: ${message}`)
    if (client) {
      try {
        await client.quit()
      } catch {
        // Ignore quit errors
      }
    }
    process.exit(1)
  }
}

checkHealth()

