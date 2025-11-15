import { createRouter } from '@/lib/create-app'
import {
  getAllMembershipHandler,
  getMembershipHandler,
} from '@/handlers/membership.handler'
import { membershipCheckoutHandler } from '@/handlers/membership-checkout.handler'

const membershipRoute = createRouter()
  .basePath('/memberships')
  .get('/', ...getAllMembershipHandler)
  .get('/:id', ...getMembershipHandler)
  .post('/checkout', ...membershipCheckoutHandler)

export default membershipRoute
