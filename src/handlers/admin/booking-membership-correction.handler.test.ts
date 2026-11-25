import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import onError from '@/middlewares/error'
import route from '@/routes/admin/booking.route'

const { transaction, correct, options } = vi.hoisted(() => ({
  transaction: vi.fn(),
  correct: vi.fn(),
  options: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { $transaction: transaction } }))
vi.mock('@/services/booking-membership-correction.service', () => ({
  correctBookingToPaidMembership: correct,
  getBookingMembershipCorrectionOptions: options,
}))
function app(role?: string) {
  const router = createRouter()
  router.use('*', async (c, next) => {
    c.set('logger', { fatal: vi.fn(), error: vi.fn() } as any)
    if (role) c.set('admin', { id: 'session-admin', role } as any)
    await next()
  })
  router.onError(onError)
  router.route('/admin', route)
  return router
}
const payload = { membershipUserId: 'target', reason: 'Salah input gratis' }
function request(role?: string, body: unknown = payload) {
  return app(role).request(
    '/admin/bookings/booking-1/correct-complimentary-membership',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  transaction.mockImplementation((callback) => callback('tx'))
  correct.mockResolvedValue({ id: 'audit', hours: 20 })
  options.mockResolvedValue({ hours: 20, memberships: [] })
})
describe('booking membership correction access', () => {
  it.each([
    undefined,
    'CASHIER',
    'ADMIN_VIEWER',
    'ADMIN_COACHING',
    'COACH',
    'BALLBOY',
  ])('rejects %s before reading or changing data', async (role) => {
    expect((await request(role)).status).toBe(role ? 403 : 401)
    expect(
      (
        await app(role).request(
          '/admin/bookings/booking-1/complimentary-membership-options',
        )
      ).status,
    ).toBe(role ? 403 : 401)
    expect(transaction).not.toHaveBeenCalled()
  })
  it('uses session admin, URL booking and a serializable transaction', async () => {
    expect((await request('ADMIN')).status).toBe(200)
    expect(correct).toHaveBeenCalledWith('tx', {
      ...payload,
      bookingId: 'booking-1',
      adminId: 'session-admin',
    })
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 10000,
    })
  })
  it.each([
    { ...payload, adminId: 'spoof' },
    { ...payload, hours: 1 },
    { ...payload, userId: 'other' },
    { ...payload, reason: ' ' },
    { ...payload, membershipUserId: '' },
  ])('rejects invalid or injected fields %j', async (body) => {
    expect((await request('ADMIN', body)).status).toBe(422)
    expect(transaction).not.toHaveBeenCalled()
  })
})

it('locks a booking before cancellation reads its possibly corrected funding source', async () => {
  const lock = vi.fn()
  const read = vi.fn().mockResolvedValue(null)
  transaction.mockImplementation((callback) =>
    callback({ $queryRaw: lock, booking: { findUnique: read } }),
  )
  const response = await app('ADMIN').request(
    '/admin/bookings/booking-1/cancel',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancel' }),
    },
  )
  expect(response.status).toBe(404)
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
    read.mock.invocationCallOrder[0],
  )
})
