import { serve } from '@hono/node-server'
import app from './src/app'
import { env } from './src/env'
import {
  startSchedulerWorker,
  scheduleExpiryCheck,
} from './src/services/scheduler.service'

const port = Number(env.port) || 3000

// Start the scheduler worker
startSchedulerWorker()

// Schedule the expiry check job
scheduleExpiryCheck().catch((err) => {
  console.error('Failed to schedule expiry check:', err)
})

serve(
  {
    fetch: app.fetch,
    port: port,
  },
  (info) => {
    console.log(`🚀 Server is running on port http://localhost:${info.port}`)
    console.log(`📅 Transaction expiry checker is running`)
  },
)
