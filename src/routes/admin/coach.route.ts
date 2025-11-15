import { createRouter } from '@/lib/create-app'
import { getAvailableCoachesHandler } from '@/handlers/coach.handler'

const adminCoachRoute = createRouter()
  .basePath('/coach')
  .get('/availability', ...getAvailableCoachesHandler)

export default adminCoachRoute

