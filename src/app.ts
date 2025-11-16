import dayjs from 'dayjs'
import 'dayjs/locale/id.js' // Added  extension to fix module resolution in ES modules
import duration from 'dayjs/plugin/duration.js'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'

import { serveStatic } from '@hono/node-server/serve-static'
import { JAKARTA_TZ } from './config'
import createApp from './lib/create-app'
import adminAnalyticsRoute from './routes/admin/analytics.route'
import adminAuthRoute from './routes/admin/auth.route'
import adminBallboyCostRoute from './routes/admin/ballboy-cost.route'
import adminBannerRoute from './routes/admin/banner.route'
import adminBookedCourtRoute from './routes/admin/booked-court.route'
import adminBookedCoachRoute from './routes/admin/booked-coach.route'
import adminBookedBallboyRoute from './routes/admin/booked-ballboy.route'
import adminBookedInventoryRoute from './routes/admin/booked-inventory.route'
import adminBookingRoute from './routes/admin/booking.route'
import adminClassRoute from './routes/admin/class.route'
import adminClassBookingRoute from './routes/admin/class-booking.route'
import adminCoachCostRoute from './routes/admin/coach-cost.route'
import adminCoachRoute from './routes/admin/coach.route'
import adminCoachTypeRoute from './routes/admin/coach-type.route'
import adminCourtCostRoute from './routes/admin/court-cost.route'
import adminCourtRoute from './routes/admin/court.route'
import adminHomeRoute from './routes/admin/home.route'
import adminInventoryRoute from './routes/admin/inventory.route'
import adminMembershipRoute from './routes/admin/membership.route'
import adminMembershipTransactionRoute from './routes/admin/membership-transaction.route'
import adminPaymentMethodRoute from './routes/admin/payment-method.route'
import adminStaffRoute from './routes/admin/staff.route'
import adminStaffCostRoute from './routes/admin/staff-cost.route'
import adminTournamentRoute from './routes/admin/tournament.route'
import adminUserRoute from './routes/admin/user.route'
import adminCheckoutRoute from './routes/admin/checkout.route'
import authRoute from './routes/auth.route'
import bannerRoute from './routes/banner.route'
import checkoutRoute from './routes/checkout.route'
import classRoute from './routes/class.route'
import courtRoute from './routes/court.route'
import healthRoute from './routes/health.route'
import homeRoute from './routes/home.route'
import coachRoute from './routes/coach.route'
import inventoryRoute from './routes/inventory.route'
import invoiceRoute from './routes/invoice.route'
import phoneVerificationRoute from './routes/phone.route'
import paymentMethodRoute from './routes/payment-method.route'
import membershipRoute from './routes/membership.route'
import xenditWebhookRoute from './routes/xendit-webhook.route'
import xenditTestRoute from './routes/xendit-test.route'
import ballboyRoute from './routes/ballboy.route'
import tournamentRoute from './routes/tournament.route'
import passwordResetRoute from './routes/password-reset.route'
import clubRoute from './routes/club.route'
import adminClubRoute from './routes/admin/club.route'

dayjs.locale('id')
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(duration)
dayjs.extend(isSameOrBefore)
dayjs.tz.setDefault(JAKARTA_TZ)

const app = createApp()

app.use('/storage/*', serveStatic({ root: './src' }))

// ADD NEW ROUTES HERE
const routes = [
  homeRoute,
  healthRoute,
  phoneVerificationRoute,
  authRoute,
  bannerRoute,
  courtRoute,
  classRoute,
  membershipRoute,
  coachRoute,
  ballboyRoute,
  inventoryRoute,
  invoiceRoute,
  paymentMethodRoute,
  checkoutRoute,
  tournamentRoute,
  clubRoute,
  xenditWebhookRoute,
  xenditTestRoute,
  passwordResetRoute,
]

// ADD NEW ADMIN ROUTES HERE
const adminRoutes = [
  adminHomeRoute,
  adminAnalyticsRoute,
  adminAuthRoute,
  adminInventoryRoute,
  adminStaffRoute,
  adminCourtRoute,
  adminCourtCostRoute,
  adminBallboyCostRoute,
  adminCoachCostRoute,
  adminCoachRoute,
  adminStaffCostRoute,
  adminCoachTypeRoute,
  adminBannerRoute,
  adminBookingRoute,
  adminBookedCourtRoute,
  adminBookedCoachRoute,
  adminBookedBallboyRoute,
  adminBookedInventoryRoute,
  adminClassRoute,
  adminClassBookingRoute,
  adminMembershipRoute,
  adminMembershipTransactionRoute,
  adminPaymentMethodRoute,
  adminTournamentRoute,
  adminClubRoute,
  adminUserRoute,
  adminCheckoutRoute,
]

routes.forEach((route) => {
  app.route('/', route)
})

adminRoutes.forEach((route) => {
  app.route('/admin', route)
})

export default app
