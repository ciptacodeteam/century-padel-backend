import {
  getUserInvoicesHandler,
  getInvoiceDetailHandler,
} from '@/handlers/invoice.handler'
import { createRouter } from '@/lib/create-app'

const invoiceRoute = createRouter()
  .basePath('/invoices')
  .get('/', ...getUserInvoicesHandler)
  .get('/:id', ...getInvoiceDetailHandler)

export default invoiceRoute
