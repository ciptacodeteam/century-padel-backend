import {
  createStaffCostHandler,
  getStaffCostHandler,
  overrideSingleStaffCostHandler,
  updateStaffCostHandler,
} from '@/handlers/admin/staff-cost.handler'
import { createRouter } from '@/lib/create-app'

const adminStaffCostRoute = createRouter()
  .basePath('/staff-costs')
  .get('/', ...getStaffCostHandler)
  .post('/', ...createStaffCostHandler)
  .put('/:id', ...updateStaffCostHandler)
  .put('/override', ...overrideSingleStaffCostHandler)

export default adminStaffCostRoute
