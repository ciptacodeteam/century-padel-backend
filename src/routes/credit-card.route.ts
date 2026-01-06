import { factory } from '@/lib/create-app'
import {
  listCreditCardsHandler,
  getCreditCardHandler,
  saveCreditCardHandler,
  updateCreditCardHandler,
  deleteCreditCardHandler,
} from '@/handlers/credit-card.handler'

const router = factory.createRouter()

/**
 * GET /credit-cards
 * List all saved credit cards for the authenticated user
 */
router.get('/', listCreditCardsHandler)

/**
 * POST /credit-cards
 * Save a new credit card (tokenized via Xendit)
 */
router.post('/', saveCreditCardHandler)

/**
 * GET /credit-cards/:id
 * Get a specific credit card
 */
router.get('/:id', getCreditCardHandler)

/**
 * PUT /credit-cards/:id
 * Update credit card (mark as default, etc.)
 */
router.put('/:id', updateCreditCardHandler)

/**
 * DELETE /credit-cards/:id
 * Delete a credit card
 */
router.delete('/:id', deleteCreditCardHandler)

export default router
