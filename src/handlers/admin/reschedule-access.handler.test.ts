import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import onError from '@/middlewares/error'
import {
  enforceManagerRestrictions,
  requireAdminAuth,
} from '@/middlewares/auth'
import route from '@/routes/admin/booked-court.route'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  detail: vi.fn(),
  slot: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { $transaction: mocks.transaction } }))
vi.mock('@/services/email.service', () => ({
  queueSendTemplatedEmail: vi.fn(),
}))

function app(role?: string) {
  const router = createRouter()
  router.use('*', async (c, next) => {
    c.set('logger', { fatal: vi.fn(), error: vi.fn() } as any)
    if (role) c.set('admin', { id: 'staff-1', role } as any)
    await next()
  })
  router.use('/admin/*', requireAdminAuth, enforceManagerRestrictions)
  router.onError(onError)
  router.route('/admin', route)
  return router
}
function request(role?: string) {
  return app(role).request('/admin/booked-courts/detail-1/reschedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newSlotId: 'target-slot' }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-26T10:00:00+07:00'))
  mocks.transaction.mockImplementation((callback) =>
    callback({
      $queryRaw: vi.fn(),
      bookingDetail: { findUnique: mocks.detail },
      slot: { findUnique: mocks.slot },
    }),
  )
  mocks.detail.mockResolvedValue({
    id: 'detail-1',
    slotId: 'old-slot',
    cancelledAt: null,
    booking: { status: 'CONFIRMED' },
    slot: { startAt: new Date('2026-10-28T10:00:00+07:00') },
  })
  mocks.slot.mockResolvedValue(null)
})
afterEach(() => vi.useRealTimers())
describe('admin and manager reschedule access', () => {
  it.each(['ADMIN', 'ADMIN_VIEWER'])(
    'allows %s through authorization and the exact 48-hour cutoff',
    async (role) => {
      const response = await request(role)
      // Target lookup proves both authorization and the cutoff passed.
      expect(mocks.slot).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'target-slot' } }),
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        msg: 'Target court slot not found',
      })
    },
  )
  it('rejects manager rescheduling less than 48 hours before the original slot', async () => {
    vi.setSystemTime(new Date('2026-10-26T10:00:00.001+07:00'))
    const response = await request('ADMIN_VIEWER')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      msg: expect.stringContaining('48 hours'),
    })
    expect(mocks.slot).not.toHaveBeenCalled()
  })
  it('requires an authenticated administrator', async () => {
    expect((await request()).status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
