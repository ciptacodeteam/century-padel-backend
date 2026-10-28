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
        remainingSessions: 18,
        totalComplimentarySessions: 2,
        remainingComplimentarySessions: 2,
        complimentaryGrants: [
          {
            id: 'grant-1',
            hours: 2,
            createdAt: new Date('2026-02-02'),
            reason: 'Private complimentary note',
            adminId: 'secret-admin',
          },
        ],
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
    expect(payload.data.activity.events).toContainEqual(
      expect.objectContaining({ type: 'COMPLIMENTARY', hours: 2 }),
    )
    expect(JSON.stringify(payload)).not.toContain('Private complimentary note')
    expect(JSON.stringify(payload)).not.toContain('secret-admin')
    expect(JSON.stringify(payload)).not.toContain('Internal admin note')
    expect(JSON.stringify(payload)).not.toContain('private-admin-id')
  })
})

it('returns a funded future membership under upcoming and activates it at the start instant', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-11-01T16:59:59Z'))
    const record = {
      id: 'future',
      userId: 'current-user',
      acquisitionType: 'PURCHASE',
      createdAt: new Date('2026-10-29'),
      startDate: new Date('2026-11-01T17:00:00Z'),
      endDate: new Date('2026-12-01T17:00:00Z'),
      remainingSessions: 10,
      isExpired: false,
      isSuspended: false,
      membership: { name: '10 Jam', sessions: 10, benefits: [] },
      invoice: {
        number: 'INV-FUTURE',
        status: 'PAID',
        paidAt: new Date('2026-10-29'),
      },
      bookingDetails: [],
      outgoingTransfers: [],
      complimentaryGrants: [],
      incomingTransfer: null,
    }
    findMany.mockResolvedValue([
      record,
      {
        ...record,
        id: 'unpaid',
        invoice: { ...record.invoice, status: 'PENDING' },
      },
    ])
    const before = (await (await app().request('/my')).json()) as any
    expect(before.data.upcoming.map((item: any) => item.id)).toEqual(['future'])
    expect(before.data.active).toHaveLength(0)
    vi.setSystemTime(new Date('2026-11-01T17:00:00Z'))
    findMany.mockResolvedValue([record])
    const after = (await (await app().request('/my')).json()) as any
    expect(after.data.upcoming).toHaveLength(0)
    expect(after.data.active.map((item: any) => item.id)).toEqual(['future'])
  } finally {
    vi.useRealTimers()
  }
})
