import { startSchedulerWorker, scheduleExpiryCheck } from '@/services/scheduler.service'
import { log } from '@/lib/logger'

/**
 * Start the scheduler worker
 * This can run as a separate process for better resource management
 */
const main = async () => {
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
  } catch (error) {
    log.error({ error }, 'Failed to start scheduler worker')
    process.exit(1)
  }
}

main()
