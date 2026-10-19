import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import { getUserMembershipsHandler } from './membership.handler'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { membershipUser: { findMany } } }))
vi.mock('@/services/schedule-visibility.service', () => ({
  getUserScheduleVisibilityMonths: vi.fn(),
}))

function app(authenticated = true) {
  const router = createRouter()
  router.use('*', async (c, next) => {
    if (authenticated) c.set('user', { id: 'current-user' } as any)
    c.set('logger', { fatal: vi.fn() } as any)
    await next()
  })
  router.get('/my', ...getUserMembershipsHandler)
  return router
}
beforeEach(() => vi.clearAllMocks())

describe('membership customer history access', () => {
  it('requires authentication before reading memberships', async () => {
    const response = await app(false).request('/my')
    expect(response.status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('scopes history to the authenticated user and omits internal transfer metadata', async () => {
    findMany.mockResolvedValue([
      {
        id: 'package-1',
        userId: 'current-user',
        acquisitionType: 'PURCHASE',
        createdAt: new Date('2026-01-01'),
        startDate: new Date('2026-01-01'),
        endDate: new Date('2030-01-01'),
        remainingSessions: 16,
        isExpired: false,
        isSuspended: false,
        membership: { name: '20 Jam', sessions: 20, benefits: [] },
        invoice: {
          number: 'INV-1',
          status: 'PAID',
          paidAt: new Date('2026-01-01'),
        },
        incomingTransfer: null,
        bookingDetails: [],
        outgoingTransfers: [
          {
            id: 'transfer-1',
            transferredHours: 4,
            createdAt: new Date('2026-02-01'),
            cancelledAt: null,
            toUser: { name: 'Budi' },
            reason: 'Internal admin note',
            transferredByAdminId: 'private-admin-id',
          },
        ],
      },
    ])
    const response = await app().request('/my')
    expect(response.status).toBe(200)
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'current-user' })
    const payload = (await response.json()) as {
      data: {
        activity: { events: Array<{ type: string; [key: string]: unknown }> }
        active: Array<Record<string, unknown>>
      }
    }
    expect(
      payload.data.activity.events.find(
        (event) => event.type === 'TRANSFER_OUT',
      ),
    ).toMatchObject({
      title: 'Transfer ke Budi',
      hours: -4,
      membershipUserId: 'package-1',
    })
    expect(payload.data.active[0]).not.toHaveProperty('outgoingTransfers')
    expect(payload.data.active[0]).not.toHaveProperty('bookingDetails')
    expect(JSON.stringify(payload)).not.toContain('Internal admin note')
    expect(JSON.stringify(payload)).not.toContain('private-admin-id')
  })
})
