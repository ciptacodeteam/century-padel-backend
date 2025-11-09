import { env } from '@/env'
import { log } from '@/lib/logger'

/**
 * Parse Redis URL and return connection options for BullMQ
 */
export const getRedisConnection = () => {
  const redisUrl = env.redisUrl || 'redis://localhost:6379'

  try {
    const url = new URL(redisUrl)
    const connection = {
      host: url.hostname || 'localhost',
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
      db: url.pathname ? parseInt(url.pathname.slice(1), 10) : 0,
    }

    // Remove undefined password to avoid connection issues
    if (!connection.password) {
      delete connection.password
    }

    return connection
  } catch (error) {
    log.error({ error, redisUrl }, 'Invalid Redis URL format')
    throw new Error(`Invalid Redis URL: ${redisUrl}`)
  }
}

/**
 * Get Redis connection string for direct Redis client
 */
export const getRedisUrl = () => {
  return env.redisUrl || 'redis://localhost:6379'
}
