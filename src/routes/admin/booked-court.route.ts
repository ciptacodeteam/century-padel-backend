import { createRouter } from '@/lib/create-app'
import {
  getAllBookedCourtsHandler,
  getBookedCourtDetailHandler,
  getBookedCourtsSummaryHandler,
  getBookingsByCourtHandler,
  cancelBookingHandler,
  rescheduleCourtBookingHandler,
} from '@/handlers/admin/booked-court.handler'

const adminBookedCourtRoute = createRouter()
  .basePath('/booked-courts')
  .get('/', ...getAllBookedCourtsHandler)
  .get('/summary', ...getBookedCourtsSummaryHandler)
  .get('/:id', ...getBookedCourtDetailHandler)
  .get('/by-court/:id', ...getBookingsByCourtHandler)
  .put('/:id/cancel', ...cancelBookingHandler)
  .put('/:id/reschedule', ...rescheduleCourtBookingHandler)

export default adminBookedCourtRoute
