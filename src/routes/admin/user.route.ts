import {
  banUserHandler,
  getAllUsersHandler,
  getUserDetailHandler,
  sendResetPasswordLinkHandler,
  unbanUserHandler,
  updateUserHandler,
  searchCustomersHandler,
  getCustomerMembershipDetailsHandler,
} from '@/handlers/admin/user.handler'
import {
  getCustomerComplimentaryCreditsHandler,
  grantComplimentaryCreditHandler,
  revokeComplimentaryCreditHandler,
} from '@/handlers/complimentary-credit.handler'
import { createRouter } from '@/lib/create-app'
import {
  requireAdminWriteAccess,
  requireComplimentaryCreditGrantAccess,
} from '@/middlewares/auth'

const adminUserRoute = createRouter()
  .basePath('/customers')
  .get('/', ...getAllUsersHandler)
  .get('/search', ...searchCustomersHandler)
  .get('/:id', ...getUserDetailHandler)
  .get('/:id/membership', ...getCustomerMembershipDetailsHandler)
  .get('/:id/complimentary-credits', ...getCustomerComplimentaryCreditsHandler)
  .post(
    '/:id/complimentary-credits',
    requireComplimentaryCreditGrantAccess,
    ...grantComplimentaryCreditHandler,
  )
  .post(
    '/:id/complimentary-credits/:creditId/revoke',
    requireAdminWriteAccess,
    ...revokeComplimentaryCreditHandler,
  )
  .put('/:id', ...updateUserHandler)
  .post('/:id/send-reset-password', ...sendResetPasswordLinkHandler)
  // .post('/:id/send-change-phone', ...sendChangePhoneLinkHandler) # salah
  .put('/:id/ban', ...banUserHandler)
  .post('/:id/unban', ...unbanUserHandler)

export default adminUserRoute
