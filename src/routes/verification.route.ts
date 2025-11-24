import {
  sendVerificationOtpHandler,
  verifyVerificationOtpHandler,
} from '@/handlers/verification.handler'

import { createRouter } from '@/lib/create-app'

const verificationRoute = createRouter()
  .basePath('/verification')
  .post('/send-otp', ...sendVerificationOtpHandler)
  .post('/verify-otp', ...verifyVerificationOtpHandler)

export default verificationRoute
