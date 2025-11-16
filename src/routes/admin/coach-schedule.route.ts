import { createRouter } from '@/lib/create-app'
import { getMyCoachScheduleHandler } from '@/handlers/admin/coach-schedule.handler'

const adminCoachScheduleRoute = createRouter()
	.basePath('/coach')
	.get('/me/schedule', ...getMyCoachScheduleHandler)

export default adminCoachScheduleRoute


