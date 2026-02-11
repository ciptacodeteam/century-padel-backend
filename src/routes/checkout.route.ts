import {
  checkoutHandler,
  cancelPaymentSessionHandler,
} from '@/handlers/checkout.handler'
import { createRouter } from '@/lib/create-app'

const checkoutRoute = createRouter()
  .basePath('/checkout')
  .post('/', ...checkoutHandler)
  .post('/cancel-session', ...cancelPaymentSessionHandler)

export default checkoutRoute
