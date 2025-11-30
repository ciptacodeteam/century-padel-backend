/**
 * Health check script for worker processes
 * Checks Redis connection to ensure worker dependencies are available
 */

import { getRedisUrl } from '@/lib/redis'
import Redis from 'ioredis'

const checkHealth = async () => {
  let client: Redis | null = null
  try {
    // Use Redis URL directly
    const redisUrl = getRedisUrl()
    
    if (!redisUrl) {
      console.error('REDIS_URL not configured')
      process.exit(1)
    }
    
    // Create Redis client with shorter timeout for healthcheck
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 0, // No retries for healthcheck
      lazyConnect: false,
      connectTimeout: 3000, // 3 second timeout
      retryStrategy: () => null, // Don't retry
      enableReadyCheck: false,
      enableOfflineQueue: false,
      showFriendlyErrorStack: false,
    })

    // Simple ping with timeout
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 3000)
      ),
    ])

    if (result === 'PONG') {
      await client.quit()
      process.exit(0)
    } else {
      await client.quit()
      process.exit(1)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    
    // Clean up
    if (client) {
      try {
        await client.quit()
      } catch {
        // Ignore
      }
    }
    
    // Don't log DNS errors (they're often transient)
    if (!message.includes('ESERVFAIL') && !message.includes('getaddrinfo') && !message.includes('ENOTFOUND')) {
      console.error(`Health check failed: ${message}`)
    }
    
    process.exit(1)
  }
}

checkHealth()

