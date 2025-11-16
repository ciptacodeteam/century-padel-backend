import {
  xenditWebhookHandler,
  xenditPaymentTokenWebhookHandler,
  xenditPaymentRequestWebhookHandler,
  xenditPaymentStatusWebhookHandler,
} from '@/handlers/xendit-webhook.handler'
import { createRouter } from '@/lib/create-app'

const xenditWebhookRoute = createRouter()
  .basePath('/webhooks/xendit')
  // Legacy unified webhook endpoint (for backward compatibility)
  .post('/', ...xenditWebhookHandler)
  // V3 Webhook endpoints - separated by type
  .post('/payment-token', ...xenditPaymentTokenWebhookHandler)
  .post('/payment-request', ...xenditPaymentRequestWebhookHandler)
  .post('/payment-status', ...xenditPaymentStatusWebhookHandler)

export default xenditWebhookRoute
