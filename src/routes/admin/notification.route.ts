import { createRouter } from '@/lib/create-app'
import {
  getAdminNotificationsHandler,
  pushAdminNotificationHandler,
} from '@/handlers/notification.handler'

const adminNotificationRoute = createRouter()
  .basePath('/notifications')
  .get('/', ...getAdminNotificationsHandler)
  .post('/', ...pushAdminNotificationHandler)

export default adminNotificationRoute
