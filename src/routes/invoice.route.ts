import {
  getUserInvoicesHandler,
  getInvoiceDetailHandler,
  expireInvoiceHandler,
  cancelUserBookingHandler,
} from '@/handlers/invoice.handler'
import { createRouter } from '@/lib/create-app'

const invoiceRoute = createRouter()
  .basePath('/invoices')
  .get('/', ...getUserInvoicesHandler)
  .get('/:id', ...getInvoiceDetailHandler)
  .post('/:id/expire', ...expireInvoiceHandler)
  .post('/:id/cancel-booking', ...cancelUserBookingHandler)

export default invoiceRoute
