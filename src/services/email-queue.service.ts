import { Queue, Worker, type Job } from 'bullmq'
import { log } from '@/lib/logger'
import { getRedisConnection } from '@/lib/redis'

/**
 * Email job data structure
 */
export interface EmailJob {
  to: string
  subject: string
  template: string
  variables: Record<string, any>
  retries?: number
}

/**
 * Create or get the email queue
 */
export const emailQueue = new Queue<EmailJob>('email', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

/**
 * Add email job to queue
 */
export const queueEmail = async (jobData: EmailJob) => {
  try {
    const job = await emailQueue.add('send-email', jobData, {
      jobId: `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    })
    log.info({ jobId: job.id }, 'Email job queued successfully')
    return job
  } catch (error) {
    log.error({ error }, 'Failed to queue email job')
    throw error
  }
}

/**
 * Get queue stats
 */
export const getEmailQueueStats = async () => {
  const counts = await emailQueue.getJobCounts()
  const isPaused = await emailQueue.isPaused()
  return {
    ...counts,
    isPaused,
  }
}

/**
 * Initialize email queue worker (to be called from worker process)
 */
export const initEmailWorker = (
  processor: (job: Job<EmailJob>) => Promise<void>,
) => {
  const worker = new Worker<EmailJob>('email', processor, {
    connection: getRedisConnection(),
    concurrency: 5, // Process 5 emails concurrently
  })

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Email job completed')
  })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, 'Email job failed')
  })

  worker.on('error', (err) => {
    log.error({ error: err }, 'Email worker error')
  })

  return worker
}

/**
 * Close the queue and worker
 */
export const closeEmailQueue = async () => {
  await emailQueue.close()
}
