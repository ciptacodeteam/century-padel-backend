import { createRouter } from '@/lib/create-app'
import { getPublicPartnershipLogosHandler } from '@/handlers/partnership.handler'

const partnershipRoute = createRouter()
  .basePath('/partnerships')
  .get('/', ...getPublicPartnershipLogosHandler)

export default partnershipRoute


