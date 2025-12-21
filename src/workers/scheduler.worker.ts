import {
  startSchedulerWorker,
  scheduleExpiryCheck,
} from '@/services/scheduler.service'
import { log } from '@/lib/logger'

/**
 * Start the scheduler worker with retry logic
 * This can run as a separate process for better resource management
 */
const main = async () => {
  let retryCount = 0
  const maxRetries = 5
  const baseDelayMs = 2000 // 2 seconds

  while (retryCount < maxRetries) {
    try {
      log.info('Starting scheduler worker...')

      // Initialize the scheduled job (runs every minute)
      await scheduleExpiryCheck()

      // Start the worker to process scheduled jobs
      const worker = startSchedulerWorker()

      log.info('Scheduler worker is running')

      // Graceful shutdown
      process.on('SIGTERM', async () => {
        log.info('SIGTERM received, closing scheduler worker...')
        await worker.close()
        process.exit(0)
      })

      process.on('SIGINT', async () => {
        log.info('SIGINT received, closing scheduler worker...')
        await worker.close()
        process.exit(0)
      })

      // Exit the retry loop if successful
      return
    } catch (error) {
      retryCount++
      const delayMs = baseDelayMs * Math.pow(2, retryCount - 1) // Exponential backoff

      if (retryCount < maxRetries) {
        log.error(
          {
            error,
            retryCount,
            maxRetries,
            nextRetryInMs: delayMs,
          },
          'Failed to start scheduler worker, retrying...',
        )

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      } else {
        log.error(
          { error, retryCount, maxRetries },
          'Failed to start scheduler worker after max retries',
        )
        process.exit(1)
      }
    }
  }
}

main()
