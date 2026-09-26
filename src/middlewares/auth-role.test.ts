import {
  canGrantComplimentaryCredit,
  isManagerRestrictedAnalyticsPath,
} from '@/middlewares/auth'
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

describe('Complimentary credit grant roles', () => {
  it.each(['ADMIN', 'ADMIN_COACHING'] as const)('allows %s', (role) => {
    expect(canGrantComplimentaryCredit(role)).toBe(true)
  })

  it.each(['CASHIER', 'ADMIN_VIEWER', 'COACH', 'BALLBOY'] as const)(
    'blocks %s',
    (role) => {
      expect(canGrantComplimentaryCredit(role)).toBe(false)
    },
  )
})
