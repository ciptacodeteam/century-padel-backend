import { createRouter } from '@/lib/create-app'
import {
  getUserNotificationsHandler,
  markUserNotificationReadHandler,
} from '@/handlers/notification.handler'

const notificationRoute = createRouter()
  .basePath('/notifications')
  .get('/', ...getUserNotificationsHandler)
  .post('/:id/read', ...markUserNotificationReadHandler)

export default notificationRoute
