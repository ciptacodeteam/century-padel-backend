import {
  checkoutHandler,
  cancelPaymentSessionHandler,
  applyPromoCodeHandler,
} from '@/handlers/checkout.handler'
import { createRouter } from '@/lib/create-app'

const checkoutRoute = createRouter()
  .basePath('/checkout')
  .post('/', ...checkoutHandler)
  .post('/apply-promo', ...applyPromoCodeHandler)
  .post('/cancel-session', ...cancelPaymentSessionHandler)

export default checkoutRoute
