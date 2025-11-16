import { createRouter } from '@/lib/create-app'
import {
  createPartnershipHandler,
  deletePartnershipHandler,
  getAllPartnershipHandler,
  getPartnershipHandler,
  updatePartnershipHandler,
} from '@/handlers/admin/partnership.handler'

const adminPartnershipRoute = createRouter()
  .basePath('/partnerships')
  .get('/', ...getAllPartnershipHandler)
  .get('/:id', ...getPartnershipHandler)
  .post('/', ...createPartnershipHandler)
  .put('/:id', ...updatePartnershipHandler)
  .delete('/:id', ...deletePartnershipHandler)

export default adminPartnershipRoute


