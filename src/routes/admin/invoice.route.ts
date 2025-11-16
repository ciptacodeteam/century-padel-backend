import { createRouter } from '@/lib/create-app'
import {
  getAllInvoicesAdminHandler,
  getInvoiceDetailAdminHandler,
} from '@/handlers/admin/invoice.handler'

const adminInvoiceRoute = createRouter()
  .basePath('/invoices')
  .get('/', ...getAllInvoicesAdminHandler)
  .get('/:id', ...getInvoiceDetailAdminHandler)

export default adminInvoiceRoute


