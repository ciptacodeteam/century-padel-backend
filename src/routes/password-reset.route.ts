import {
  resetPasswordWithTokenHandler,
  verifyResetTokenHandler,
  requestPasswordResetHandler,
} from '@/handlers/auth/password-reset.handler'
import { createRouter } from '@/lib/create-app'

const passwordResetRoute = createRouter()
  .basePath('/password-reset')
  .post('/request-reset', ...requestPasswordResetHandler)
  .post('/', ...resetPasswordWithTokenHandler)
  .get('/verify', ...verifyResetTokenHandler)

export default passwordResetRoute
