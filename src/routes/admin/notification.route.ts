import { createRouter } from '@/lib/create-app'
import {
  getAdminNotificationsHandler,
  markAdminNotificationReadHandler,
  pushAdminNotificationHandler,
} from '@/handlers/notification.handler'

const adminNotificationRoute = createRouter()
  .basePath('/notifications')
  .get('/', ...getAdminNotificationsHandler)
  .post('/', ...pushAdminNotificationHandler)
  .patch('/:id/read', ...markAdminNotificationReadHandler)

export default adminNotificationRoute
