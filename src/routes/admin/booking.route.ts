import { createRouter } from '@/lib/create-app'
import {
  approveBookingTransactionHandler,
  exportBookingTransactionsToExcelHandler,
  getAllBookingTransactionsHandler,
  getBookingTransactionDetailHandler,
  rejectBookingTransactionHandler,
} from '@/handlers/admin/booking.handler'

const adminBookingRoute = createRouter()
  .basePath('/bookings')
  .get('/', ...getAllBookingTransactionsHandler)
  .get('/export/excel', ...exportBookingTransactionsToExcelHandler)
  .get('/:id', ...getBookingTransactionDetailHandler)
  .put('/:id/approve', ...approveBookingTransactionHandler)
  .put('/:id/reject', ...rejectBookingTransactionHandler)

export default adminBookingRoute

