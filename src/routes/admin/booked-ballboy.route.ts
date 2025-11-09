import { factory } from '@/lib/create-app'
import {
  cancelBallboyBookingHandler,
  getAllBookedBallboysHandler,
  getBookedBallboyDetailHandler,
} from '@/handlers/admin/booked-ballboy.handler'

const adminBookedBallboyRoute = factory
  .createApp()
  .basePath('/booked-ballboys')
  .get('/', ...getAllBookedBallboysHandler)
  .get('/:id', ...getBookedBallboyDetailHandler)
  .put('/:id/cancel', ...cancelBallboyBookingHandler)

export default adminBookedBallboyRoute
