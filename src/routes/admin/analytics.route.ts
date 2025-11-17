import { createRouter } from '@/lib/create-app'
import {
  exportAnalyticsToExcelHandler,
  getAnalyticsHandler,
  getDashboardStatsHandler,
  getDailyTransactionsHandler,
} from '@/handlers/admin/analytics.handler'

const adminAnalyticsRoute = createRouter()
  .basePath('/analytics')
  .get('/', ...getAnalyticsHandler)
  .get('/dashboard', ...getDashboardStatsHandler)
  .get('/daily-transactions', ...getDailyTransactionsHandler)
  .get('/export/excel', ...exportAnalyticsToExcelHandler)

export default adminAnalyticsRoute
