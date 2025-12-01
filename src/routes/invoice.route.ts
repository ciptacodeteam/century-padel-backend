import {
  getUserInvoicesHandler,
  getInvoiceDetailHandler,
  expireInvoiceHandler,
} from '@/handlers/invoice.handler'
import { createRouter } from '@/lib/create-app'

const invoiceRoute = createRouter()
  .basePath('/invoices')
  .get('/', ...getUserInvoicesHandler)
  .get('/:id', ...getInvoiceDetailHandler)
  .post('/:id/expire', ...expireInvoiceHandler)

export default invoiceRoute
