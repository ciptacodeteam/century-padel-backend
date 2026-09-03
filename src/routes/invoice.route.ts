import {
  getUserInvoicesHandler,
  getInvoiceDetailHandler,
  expireInvoiceHandler,
  cancelUserBookingHandler,
  mockPayInvoiceHandler,
} from '@/handlers/invoice.handler'
import { createRouter } from '@/lib/create-app'

const invoiceRoute = createRouter()
  .basePath('/invoices')
  .get('/', ...getUserInvoicesHandler)
  .get('/:id', ...getInvoiceDetailHandler)
  .post('/:id/expire', ...expireInvoiceHandler)
  .post('/:id/mock-pay', ...mockPayInvoiceHandler)
  .post('/:id/cancel-booking', ...cancelUserBookingHandler)

export default invoiceRoute
