import { isManagerRestrictedAnalyticsPath } from '@/middlewares/auth'
import { describe, expect, it } from 'vitest'

describe('Manager analytics restrictions', () => {
  it.each([
    '/admin/analytics/income-by-source',
    '/admin/analytics/payment-methods',
  ])('blocks %s', (path) => {
    expect(isManagerRestrictedAnalyticsPath(path)).toBe(true)
  })

  it.each([
    '/admin/analytics/business-insights',
    '/admin/dashboard',
    '/admin/kelola-metode-pembayaran',
    '/admin/bookings/booking-1',
  ])('allows %s', (path) => {
    expect(isManagerRestrictedAnalyticsPath(path)).toBe(false)
  })
})
