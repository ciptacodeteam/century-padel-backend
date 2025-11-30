/**
 * Health check script for worker processes
 * Checks Redis connection to ensure worker dependencies are available
 */

import { getRedisUrl } from '@/lib/redis'
import Redis from 'ioredis'

const checkHealth = async () => {
  let client: Redis | null = null
  const maxRetries = 3
  const retryDelay = 1000 // 1 second

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use Redis URL directly to avoid DNS resolution issues
      const redisUrl = getRedisUrl()
      
      // Create Redis client using connection string (more reliable)
      client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: false,
        connectTimeout: 5000,
        retryStrategy: () => null, // Don't retry on connection failure
        enableReadyCheck: false, // Skip ready check for faster connection
        enableOfflineQueue: false, // Don't queue commands when offline
      })

      // Set a timeout for the ping operation
      const pingPromise = client.ping()
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timeout')), 5000)
      )

      await Promise.race([pingPromise, timeoutPromise])
      await client.quit()

      // If we get here, Redis is healthy
      process.exit(0)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error)
      
      // Clean up client
      if (client) {
        try {
          await client.quit()
        } catch {
          // Ignore quit errors
        }
        client = null
      }

      // If it's a DNS error and we have retries left, wait and retry
      if (
        (message.includes('ESERVFAIL') ||
          message.includes('getaddrinfo') ||
          message.includes('ENOTFOUND')) &&
        attempt < maxRetries
      ) {
        // Wait before retrying (DNS might not be ready yet)
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        continue
      }

      // If all retries exhausted or non-DNS error, fail
      if (attempt === maxRetries || !message.includes('ESERVFAIL')) {
        // Only log non-DNS errors to reduce noise
        if (!message.includes('ESERVFAIL') && !message.includes('getaddrinfo')) {
          console.error(`Worker health check failed: ${message}`)
        }
        process.exit(1)
      }
    }
  }

  // Should not reach here, but just in case
  process.exit(1)
}

checkHealth()

