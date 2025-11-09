import {
  resetPasswordWithTokenHandler,
  verifyResetTokenHandler,
} from '@/handlers/auth/password-reset.handler'
import { createRouter } from '@/lib/create-app'

const passwordResetRoute = createRouter()
  .basePath('/password-reset')
  .post('/', ...resetPasswordWithTokenHandler)
  .post('/verify', ...verifyResetTokenHandler)

export default passwordResetRoute
