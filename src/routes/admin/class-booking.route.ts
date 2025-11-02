import { createRouter } from '@/lib/create-app'
import {
  approveClassBookingTransactionHandler,
  exportClassBookingTransactionsToExcelHandler,
  getAllClassBookingTransactionsHandler,
  getClassBookingTransactionDetailHandler,
  rejectClassBookingTransactionHandler,
} from '@/handlers/admin/class-booking.handler'

const adminClassBookingRoute = createRouter()
  .basePath('/class-bookings')
  .get('/', ...getAllClassBookingTransactionsHandler)
  .get('/export/excel', ...exportClassBookingTransactionsToExcelHandler)
  .get('/:id', ...getClassBookingTransactionDetailHandler)
  .put('/:id/approve', ...approveClassBookingTransactionHandler)
  .put('/:id/reject', ...rejectClassBookingTransactionHandler)

export default adminClassBookingRoute

