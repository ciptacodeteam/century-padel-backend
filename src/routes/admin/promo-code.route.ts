import { createRouter } from '@/lib/create-app'
import {
  createPromoCodeHandler,
  deletePromoCodeHandler,
  getAllPromoCodeHandler,
  getPromoCodeHandler,
  updatePromoCodeHandler,
} from '@/handlers/admin/promo-code.handler'

const adminPromoCodeRoute = createRouter()
  .basePath('/promo-code')
  .get('/', ...getAllPromoCodeHandler)
  .get('/:id', ...getPromoCodeHandler)
  .post('/', ...createPromoCodeHandler)
  .put('/:id', ...updatePromoCodeHandler)
  .delete('/:id', ...deletePromoCodeHandler)

export default adminPromoCodeRoute
