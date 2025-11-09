import { factory } from '@/lib/create-app'
import {
  cancelInventoryBookingHandler,
  getAllBookedInventoriesHandler,
  getBookedInventoryDetailHandler,
} from '@/handlers/admin/booked-inventory.handler'

const adminBookedInventoryRoute = factory
  .createApp()
  .basePath('/booked-inventories')
  .get('/', ...getAllBookedInventoriesHandler)
  .get('/:id', ...getBookedInventoryDetailHandler)
  .put('/:id/cancel', ...cancelInventoryBookingHandler)

export default adminBookedInventoryRoute
