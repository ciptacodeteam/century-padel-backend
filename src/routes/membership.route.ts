import { createRouter } from '@/lib/create-app'
import {
  getAllMembershipHandler,
  getMembershipHandler,
  getUserMembershipsHandler,
} from '@/handlers/membership.handler'
import { membershipCheckoutHandler } from '@/handlers/membership-checkout.handler'
import { requireAuth } from '@/middlewares/auth'

const membershipRoute = createRouter()
  .basePath('/memberships')
  .get('/', ...getAllMembershipHandler)
  .get('/my', requireAuth, ...getUserMembershipsHandler)
  .get('/:id', ...getMembershipHandler)
  .post('/checkout', ...membershipCheckoutHandler)

export default membershipRoute
