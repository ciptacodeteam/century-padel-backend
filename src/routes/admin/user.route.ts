import {
  banUserHandler,
  getAllUsersHandler,
  getUserDetailHandler,
  sendResetPasswordLinkHandler,
  unbanUserHandler,
  updateUserHandler,
} from '@/handlers/admin/user.handler'
import { createRouter } from '@/lib/create-app'

const adminUserRoute = createRouter()
  .basePath('/customers')
  .get('/', ...getAllUsersHandler)
  .get('/:id', ...getUserDetailHandler)
  .put('/:id', ...updateUserHandler)
  .post('/:id/send-reset-password', ...sendResetPasswordLinkHandler)
  // .post('/:id/send-change-phone', ...sendChangePhoneLinkHandler) # salah
  .put('/:id/ban', ...banUserHandler)
  .post('/:id/unban', ...unbanUserHandler)

export default adminUserRoute
