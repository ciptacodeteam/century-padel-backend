import { createRouter } from '@/lib/create-app'
import {
  banUserHandler,
  getAllUsersHandler,
  getUserDetailHandler,
  sendChangePhoneLinkHandler,
  sendResetPasswordLinkHandler,
  unbanUserHandler,
} from '@/handlers/admin/user.handler'

const adminUserRoute = createRouter()
  .basePath('/users')
  .get('/', ...getAllUsersHandler)
  .get('/:id', ...getUserDetailHandler)
  .post('/:id/send-reset-password', ...sendResetPasswordLinkHandler)
  .post('/:id/send-change-phone', ...sendChangePhoneLinkHandler)
  .put('/:id/ban', ...banUserHandler)
  .put('/:id/unban', ...unbanUserHandler)

export default adminUserRoute

