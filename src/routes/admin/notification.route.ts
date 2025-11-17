import { createRouter } from '@/lib/create-app'
import {
  getAdminNotificationsHandler,
  markAdminNotificationReadHandler,
  markAllAdminNotificationsReadHandler,
  pushAdminNotificationHandler,
} from '@/handlers/notification.handler'

const adminNotificationRoute = createRouter()
  .basePath('/notifications')
  .get('/', ...getAdminNotificationsHandler)
  .post('/', ...pushAdminNotificationHandler)
  .patch('/:id/read', ...markAdminNotificationReadHandler)
  .post('/read-all', ...markAllAdminNotificationsReadHandler)

export default adminNotificationRoute
