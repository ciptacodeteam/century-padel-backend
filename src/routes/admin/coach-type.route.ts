import { createRouter } from '@/lib/create-app'
import {
  getAllCoachTypesHandler,
  getCoachTypeHandler,
  createCoachTypeHandler,
  updateCoachTypeHandler,
  deleteCoachTypeHandler,
} from '@/handlers/admin/coach-type.handler'

const adminCoachTypeRoute = createRouter()
  .basePath('/coach-types')
  .get('/', ...getAllCoachTypesHandler)
  .get('/:id', ...getCoachTypeHandler)
  .post('/', ...createCoachTypeHandler)
  .put('/:id', ...updateCoachTypeHandler)
  .delete('/:id', ...deleteCoachTypeHandler)

export default adminCoachTypeRoute
