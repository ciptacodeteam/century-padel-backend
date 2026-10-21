import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  grantMembershipComplimentary,
  consumeMembershipHours,
} from './membership-complimentary.service'
import {
  adjustMembershipHoursForReschedule,
  restoreMembershipHoursForBooking,
} from './membership-hours.service'

const now = new Date('2026-10-21T04:00:00Z')
const input = {
  membershipUserId: 'membership',
  adminId: 'admin',
  hours: 3,
  reason: '  Kompensasi lapangan  ',
  requestId: '0db1a187-23bd-4985-8275-8ce1f3da0b40',
  now,
}
const slot = {
  startAt: new Date('2099-10-22T08:00:00Z'),
  endAt: new Date('2099-10-22T10:00:00Z'),
}

function fixture(overrides: Record<string, unknown> = {}) {
  const membership = {
    id: 'membership',
    remainingSessions: 5,
    remainingComplimentarySessions: 3,
    totalComplimentarySessions: 3,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2099-12-01'),
    isExpired: false,
    isSuspended: false,
    user: { banned: false },
    membership: { sessions: 5, type: 'ALL_HOUR' },
    invoice: { status: 'PAID', payment: { meta: null } },
    incomingTransfer: null,
    ...overrides,
  }
  const detail = {
    id: 'detail',
    membershipUserId: 'membership',
    slot,
    complimentaryMembershipHours: 0,
    membershipHoursRestored: false,
  }
  let grant: Record<string, unknown> | null = null
  const updateMembership = vi.fn(async ({ data }: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object') {
        const change = value as { increment?: number; decrement?: number }
        ;(membership as any)[key] +=
          (change.increment ?? 0) - (change.decrement ?? 0)
      } else (membership as any)[key] = value
    }
    return { ...membership }
  })
  const raw = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    staff: { findFirst: vi.fn().mockResolvedValue({ id: 'admin' }) },
    membershipUser: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (
          (where.isExpired === false && membership.isExpired) ||
          (where.isSuspended === false && membership.isSuspended) ||
          where.remainingSessions?.gte > membership.remainingSessions ||
          (where.endDate && membership.endDate <= where.endDate.gt)
        )
          return null
        return { ...membership }
      }),
      findUnique: vi.fn().mockImplementation(async () => ({ ...membership })),
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation(async () => ({ ...membership })),
      update: updateMembership,
      updateMany: vi.fn(async (args: any) => {
        if (args.where.remainingSessions?.gte > membership.remainingSessions)
          return { count: 0 }
        await updateMembership(args)
        return { count: 1 }
      }),
    },
    membershipComplimentaryGrant: {
      findUnique: vi.fn().mockImplementation(async () => grant),
      create: vi
        .fn()
        .mockImplementation(
          async ({ data }: any) =>
            (grant = { id: 'grant', createdAt: now, ...data }),
        ),
    },
    bookingDetail: {
      findMany: vi.fn().mockImplementation(async () => [{ ...detail }]),
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation(async () => ({ ...detail })),
      update: vi.fn(async ({ data }: any) => {
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object') {
            const change = value as { increment?: number; decrement?: number }
            ;(detail as any)[key] +=
              (change.increment ?? 0) - (change.decrement ?? 0)
          } else (detail as any)[key] = value
        }
        return { ...detail }
      }),
    },
  }
  return {
    raw,
    tx: raw as unknown as Prisma.TransactionClient,
    membership,
    detail,
  }
}

describe('complimentary membership grants', () => {
  it('adds complimentary hours once without changing the period or creating payment records', async () => {
    const { tx, membership, raw } = fixture()
    const result = await grantMembershipComplimentary(tx, input)
    expect(membership).toMatchObject({
      remainingSessions: 8,
      remainingComplimentarySessions: 6,
      totalComplimentarySessions: 6,
      endDate: new Date('2099-12-01'),
    })
    expect(result).toMatchObject({
      hours: 3,
      reason: 'Kompensasi lapangan',
      adminId: 'admin',
    })
    await grantMembershipComplimentary(tx, input)
    expect(membership.remainingSessions).toBe(8)
    expect(raw.membershipComplimentaryGrant.create).toHaveBeenCalledOnce()
    // The transaction intentionally has no invoice/payment write API.
  })
  it('rejects a replay with changed data', async () => {
    const { tx } = fixture()
    await grantMembershipComplimentary(tx, input)
    await expect(
      grantMembershipComplimentary(tx, { ...input, hours: 2 }),
    ).rejects.toThrow('ID permintaan')
  })
  it('checks the active Super Admin in the database before any grant or replay', async () => {
    const { tx, raw } = fixture()
    raw.staff.findFirst.mockResolvedValue(null as any)
    await expect(grantMembershipComplimentary(tx, input)).rejects.toThrow(
      'Super Admin aktif',
    )
    expect(raw.staff.findFirst).toHaveBeenCalledWith({
      where: { id: 'admin', role: 'ADMIN', isActive: true },
      select: { id: true },
    })
    expect(raw.membershipComplimentaryGrant.create).not.toHaveBeenCalled()
  })
  it.each([0, -1, 1.5, 10001, NaN, Infinity])(
    'rejects invalid hours %s',
    async (hours) => {
      const { tx, raw } = fixture()
      await expect(
        grantMembershipComplimentary(tx, { ...input, hours }),
      ).rejects.toThrow()
      expect(raw.membershipComplimentaryGrant.create).not.toHaveBeenCalled()
    },
  )
  it.each([{ reason: ' ' }, { reason: 'a'.repeat(501) }, { requestId: 'bad' }])(
    'rejects malformed grant data %j',
    async (change) => {
      await expect(
        grantMembershipComplimentary(fixture().tx, { ...input, ...change }),
      ).rejects.toThrow()
    },
  )
  it.each([
    { isSuspended: true },
    { endDate: now },
    { startDate: new Date('2099-01-01') },
    { user: { banned: true } },
    { isExpired: true, remainingSessions: 2 },
    {
      invoice: {
        payment: { meta: { refund: { status: 'COMPLETED', amount: 1 } } },
      },
    },
  ])('rejects inactive or refunded membership %j', async (change) => {
    const { tx, raw } = fixture(change)
    await expect(grantMembershipComplimentary(tx, input)).rejects.toThrow()
    expect(raw.membershipComplimentaryGrant.create).not.toHaveBeenCalled()
  })
  it('rejects an unfunded or missing membership', async () => {
    const { tx, raw } = fixture()
    raw.membershipUser.findFirst.mockResolvedValue(null as any)
    await expect(grantMembershipComplimentary(tx, input)).rejects.toThrow(
      'lunas',
    )
  })
  it('allows a depleted balance within the original membership period', async () => {
    const { tx, membership } = fixture({
      remainingSessions: 0,
      remainingComplimentarySessions: 0,
      isExpired: true,
    })
    await grantMembershipComplimentary(tx, input)
    expect(membership).toMatchObject({
      remainingSessions: 3,
      remainingComplimentarySessions: 3,
      isExpired: false,
    })
  })
})

describe('complimentary consumption, restoration and rescheduling', () => {
  it('uses complimentary first and restores the exact split only once', async () => {
    const { tx, membership, detail } = fixture({
      remainingComplimentarySessions: 1,
    })
    await consumeMembershipHours(tx, 'membership', 'booking', 2)
    expect(membership).toMatchObject({
      remainingSessions: 3,
      remainingComplimentarySessions: 0,
    })
    expect(detail.complimentaryMembershipHours).toBe(1)
    const booking = {
      userId: 'user',
      courtNormalPrice: 300000,
      createdAt: now,
      details: [detail],
    }
    expect(await restoreMembershipHoursForBooking(tx, booking)).toBe(2)
    expect(membership).toMatchObject({
      remainingSessions: 5,
      remainingComplimentarySessions: 1,
    })
    expect(await restoreMembershipHoursForBooking(tx, booking)).toBe(0)
    expect(membership.remainingSessions).toBe(5)
  })
  it('does not restore an individually cancelled detail during whole-booking cancellation', async () => {
    const { tx, raw, detail } = fixture()
    expect(
      await restoreMembershipHoursForBooking(tx, {
        userId: 'user',
        courtNormalPrice: 0,
        createdAt: now,
        details: [{ ...detail, cancelledAt: now }],
      }),
    ).toBe(0)
    expect(raw.membershipUser.update).not.toHaveBeenCalled()
  })
  it('blocks consumption after expiry or suspension and when the balance is insufficient', async () => {
    for (const changes of [
      { endDate: now },
      { isSuspended: true },
      { remainingSessions: 1 },
    ]) {
      const { tx } = fixture(changes)
      await expect(
        consumeMembershipHours(tx, 'membership', 'booking', 2),
      ).rejects.toThrow()
    }
  })
  it('does not resurrect revoked transfers or terminated memberships', async () => {
    for (const change of [
      { incomingTransfer: { cancelledAt: now } },
      { isSuspended: true, endDate: now },
    ]) {
      const { tx, detail, raw } = fixture(change)
      expect(
        await restoreMembershipHoursForBooking(tx, {
          userId: 'user',
          courtNormalPrice: 0,
          createdAt: now,
          details: [detail],
        }),
      ).toBe(0)
      expect(raw.membershipUser.update).not.toHaveBeenCalled()
    }
  })
  it('preserves complimentary accounting across a longer reschedule and cancellation', async () => {
    const { tx, membership, detail } = fixture()
    await consumeMembershipHours(tx, 'membership', 'booking', 2)
    const booking = {
      userId: 'user',
      courtNormalPrice: 0,
      createdAt: now,
      details: [detail],
    }
    const longerSlot = { ...slot, endAt: new Date('2099-10-22T11:00:00Z') }
    await adjustMembershipHoursForReschedule(tx, booking, slot, longerSlot)
    expect(detail.complimentaryMembershipHours).toBe(3)
    expect(membership).toMatchObject({
      remainingSessions: 2,
      remainingComplimentarySessions: 0,
    })
    detail.slot = longerSlot
    await restoreMembershipHoursForBooking(tx, booking)
    expect(membership).toMatchObject({
      remainingSessions: 5,
      remainingComplimentarySessions: 3,
    })
  })
  it('returns complimentary first when rescheduling to a shorter slot', async () => {
    const { tx, membership, detail } = fixture({
      remainingComplimentarySessions: 1,
    })
    await consumeMembershipHours(tx, 'membership', 'booking', 2)
    const shorter = { ...slot, endAt: new Date('2099-10-22T09:00:00Z') }
    await adjustMembershipHoursForReschedule(
      tx,
      {
        userId: 'user',
        courtNormalPrice: 0,
        createdAt: now,
        details: [detail],
      },
      slot,
      shorter,
    )
    expect(membership).toMatchObject({
      remainingSessions: 4,
      remainingComplimentarySessions: 1,
    })
    expect(detail.complimentaryMembershipHours).toBe(0)
  })
})
