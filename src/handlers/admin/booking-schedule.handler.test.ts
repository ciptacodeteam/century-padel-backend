import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import {
  getAllBookingScheduleHandler,
  getOngoingBookingScheduleHandler,
} from './booking.handler'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { booking: { findMany } } }))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
vi.mock('@/services/analytics.service', () => ({ exportDataToExcel: vi.fn() }))
vi.mock('@/services/complimentary-payment-correction.service', () => ({
  correctComplimentaryBookingToCashier: vi.fn(),
}))
vi.mock('@/services/refund.service', () => ({
  ensureCashierPaidPayment: vi.fn(),
}))

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
})

function app() {
  const router = createRouter()
  router.get('/schedule', ...getAllBookingScheduleHandler)
  router.get('/ongoing', ...getOngoingBookingScheduleHandler)
  return router
}

describe('booking schedule cancellation filters', () => {
  it.each(['/schedule', '/ongoing'])(
    '%s excludes cancelled court slots even when the parent booking stays confirmed',
    async (endpoint) => {
      const now = new Date()
      const activeDetail = {
        id: 'active-court',
        cancelledAt: null,
        membershipUserId: 'membership-1',
        court: { id: 'court-1', name: 'Court 1', image: null },
        slot: { startAt: now, endAt: new Date(now.getTime() + 3600000) },
      }
      const cancelledDetail = {
        ...activeDetail,
        id: 'cancelled-court',
        cancelledAt: now,
        slot: {
          startAt: new Date(now.getTime() - 3600000),
          endAt: now,
        },
      }
      // Simulate the relational query with a partially cancelled membership booking.
      findMany.mockImplementation(async (query) => [
        {
          id: 'confirmed-booking',
          status: 'CONFIRMED',
          user: { name: 'Member', image: null },
          details: [cancelledDetail, activeDetail].filter((detail) =>
            query.include.details.where?.cancelledAt === null
              ? detail.cancelledAt === null
              : true,
          ),
          coaches: [],
          ballboys: [],
          inventories: [],
        },
      ])
      const res = await app().request(endpoint)
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: Array<{
          details: Array<{ id: string }>
          courts: unknown[]
          schedule: { startAt: string }
        }>
      }
      expect(data).toHaveLength(1)
      if (endpoint === '/schedule') {
        expect(
          data[0].details.map((detail: { id: string }) => detail.id),
        ).toEqual(['active-court'])
      } else {
        expect(data[0].courts).toHaveLength(1)
        expect(data[0].schedule.startAt).toBe(now.toISOString())
        expect(
          findMany.mock.calls[0][0].where.details.some.cancelledAt,
        ).toBeNull()
      }
    },
  )
})
