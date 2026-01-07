import {
  deleteCreditCardHandler,
  getCreditCardHandler,
  listCreditCardsHandler,
  saveCreditCardHandler,
  updateCreditCardHandler,
} from '@/handlers/credit-card.handler'
import { createRouter } from '@/lib/create-app'

const creditCardRoute = createRouter()
  .basePath('/credit-cards')
  .get('/', ...listCreditCardsHandler)
  .post('/', ...saveCreditCardHandler)
  .get('/:id', ...getCreditCardHandler)
  .put('/:id', ...updateCreditCardHandler)
  .delete('/:id', ...deleteCreditCardHandler)

export default creditCardRoute
