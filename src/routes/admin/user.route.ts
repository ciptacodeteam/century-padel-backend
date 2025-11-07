import {
  banUserHandler,
  getAllUsersHandler,
  getUserDetailHandler,
  unbanUserHandler,
} from '@/handlers/admin/user.handler'
import { createRouter } from '@/lib/create-app'

const adminUserRoute = createRouter()
  .basePath('/customers')
  .get('/', ...getAllUsersHandler)
  .get('/:id', ...getUserDetailHandler)
  // .post('/:id/send-reset-password', ...sendResetPasswordLinkHandler) # salah
  // .post('/:id/send-change-phone', ...sendChangePhoneLinkHandler) # salah
  .put('/:id/ban', ...banUserHandler)
  .post('/unban', ...unbanUserHandler)

export default adminUserRoute
