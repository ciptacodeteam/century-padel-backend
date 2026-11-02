import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
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
describe('reschedule access before the original slot starts', () => {
  describe.each(Object.values(Role))('%s', (role) => {
    it.each([
      ['exactly 48 hours before', '2026-10-28T10:00:00+07:00'],
      ['less than 48 hours before', '2026-10-27T10:00:00+07:00'],
      ['one millisecond before the original start', '2026-10-26T10:00:00.001+07:00'],
    ])('allows rescheduling %s', async (_, startAt) => {
      mocks.detail.mockResolvedValue({
        id: 'detail-1',
        slotId: 'old-slot',
        cancelledAt: null,
        booking: { status: 'CONFIRMED' },
        slot: { startAt: new Date(startAt) },
      })
      const response = await request(role)
      // Target lookup proves authorization and original-slot timing both passed.
      expect(mocks.slot).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'target-slot' } }),
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        msg: 'Target court slot not found',
      })
    })

    it.each([
      ['at the original start time', '2026-10-26T10:00:00+07:00'],
      ['one millisecond after the original start', '2026-10-26T09:59:59.999+07:00'],
      ['after the original slot', '2026-10-25T10:00:00+07:00'],
    ])('rejects rescheduling %s', async (_, startAt) => {
      const detail = await mocks.detail()
      mocks.detail.mockResolvedValue({
        ...detail,
        slot: { startAt: new Date(startAt) },
      })
      const response = await request(role)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        msg: 'Bad request. Cannot reschedule a booking that has already started',
      })
      expect(mocks.slot).not.toHaveBeenCalled()
    })
  })

  it.each([
    ['cancelled booking', { booking: { status: 'CANCELLED' } }],
    ['cancelled court', { cancelledAt: new Date() }],
  ])('still rejects a %s', async (_, overrides) => {
    const detail = await mocks.detail()
    mocks.detail.mockResolvedValue({ ...detail, ...overrides })
    const response = await request('ADMIN')
    expect(response.status).toBe(400)
    expect(mocks.slot).not.toHaveBeenCalled()
  })

  it('still rejects a target slot in the past', async () => {
    mocks.slot.mockResolvedValue({
      id: 'target-slot',
      type: 'COURT',
      courtId: 'court-1',
      isAvailable: true,
      startAt: new Date('2026-10-26T09:00:00+07:00'),
    })
    const response = await request('ADMIN')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      msg: 'Bad request. Selected slot time has already passed',
    })
  })

  it('still rejects an unavailable target slot', async () => {
    mocks.slot.mockResolvedValue({ type: 'COURT', isAvailable: false })
    const response = await request('ADMIN')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      msg: 'Bad request. Selected slot is no longer available',
    })
  })

  it('requires an authenticated administrator', async () => {
    expect((await request()).status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
