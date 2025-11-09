import { getCustomerPaymentMethodsHandler } from '@/handlers/payment-method.handler'
import { createRouter } from '@/lib/create-app'

const paymentMethodRoute = createRouter()
  .basePath('/payment-methods')
  .get('/', ...getCustomerPaymentMethodsHandler)

export default paymentMethodRoute

