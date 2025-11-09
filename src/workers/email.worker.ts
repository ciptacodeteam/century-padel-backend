import type { Job } from 'bullmq'
import {
  initEmailWorker,
  closeEmailQueue,
  type EmailJob,
} from '@/services/email-queue.service'
import { sendTemplatedEmail } from '@/services/email.service'
import { log } from '@/lib/logger'

/**
 * Email job processor
 * This runs in a separate worker process
 */
const emailProcessor = async (
  job: Job<EmailJob, any, string>,
): Promise<void> => {
  const { to, subject, template, variables } = job.data

  try {
    log.info({ jobId: job.id, to }, `Processing email job: ${template}`)

    // If template is 'custom', use the subject directly
    if (template === 'custom') {
      const { sendEmail } = await import('@/services/email.service')
      const html = variables.html || `<p>${subject}</p>`
      await sendEmail(to, subject, html)
    } else {
      // Use templated email
      await sendTemplatedEmail(
        to,
        template as Parameters<typeof sendTemplatedEmail>[1],
        variables,
      )
    }

    log.info({ jobId: job.id, to }, 'Email sent successfully')
    return
  } catch (error) {
    log.error({ jobId: job.id, to, error }, 'Failed to process email job')
    throw error
  }
}

/**
 * Start the email worker
 */
const startWorker = async () => {
  try {
    log.info('Starting email worker...')
    const worker = initEmailWorker(emailProcessor)
    log.info('Email worker started successfully')

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      log.info('SIGTERM received, shutting down email worker...')
      await worker.close()
      await closeEmailQueue()
      process.exit(0)
    })

    process.on('SIGINT', async () => {
      log.info('SIGINT received, shutting down email worker...')
      await worker.close()
      await closeEmailQueue()
      process.exit(0)
    })
  } catch (error) {
    log.error({ error }, 'Failed to start email worker')
    process.exit(1)
  }
}

// Start the worker
startWorker()
