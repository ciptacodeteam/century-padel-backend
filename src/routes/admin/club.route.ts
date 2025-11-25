import {
  approveClubHandler,
  createClubHandler,
  deleteClubHandler,
  getAllClubHandler,
  getClubHandler,
  updateClubHandler,
} from '@/handlers/admin/club.handler'
import { createRouter } from '@/lib/create-app'

const adminClubRoute = createRouter()
  .basePath('/clubs')
  .post('/', ...createClubHandler)
  .get('/', ...getAllClubHandler)
  .get('/:id', ...getClubHandler)
  .put('/:id', ...updateClubHandler)
  .post('/:id/approve', ...approveClubHandler)
  .delete('/:id', ...deleteClubHandler)

export default adminClubRoute
