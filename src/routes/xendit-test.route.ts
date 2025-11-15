import xenditTestHandler from '@/handlers/xendit-test.handler'
import { createRouter } from '@/lib/create-app'

// Dev-only endpoints to trigger Xendit test-mode payment simulations
const xenditTestRoute = createRouter()
  .basePath('/xendit-test')
  .post('/payment-requests/:id/simulate', ...xenditTestHandler)
  .post('/payments/:id/simulate', ...xenditTestHandler)

export default xenditTestRoute
