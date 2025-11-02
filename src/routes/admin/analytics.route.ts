import { createRouter } from '@/lib/create-app'
import {
  exportAnalyticsToExcelHandler,
  getAnalyticsHandler,
} from '@/handlers/admin/analytics.handler'

const adminAnalyticsRoute = createRouter()
  .basePath('/analytics')
  .get('/', ...getAnalyticsHandler)
  .get('/export/excel', ...exportAnalyticsToExcelHandler)

export default adminAnalyticsRoute

