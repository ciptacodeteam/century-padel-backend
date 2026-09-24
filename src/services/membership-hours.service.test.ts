import {
  adjustMembershipHoursForReschedule,
  calculateCourtHours,
  restoreMembershipHoursForBooking,
} from '@/services/membership-hours.service'
import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

const oneHourSlot = {
  startAt: new Date('2026-09-20T08:00:00.000Z'),
  endAt: new Date('2026-09-20T09:00:00.000Z'),
}

describe('membership hours', () => {
  it('counts package usage from actual court duration', () => {
    expect(calculateCourtHours([oneHourSlot, oneHourSlot])).toBe(2)
    expect(
      calculateCourtHours([
        {
          startAt: new Date('2026-09-20T08:00:00.000Z'),
          endAt: new Date('2026-09-20T09:30:00.000Z'),
        },
      ]),
    ).toBe(2)
  })

  it('restores two cancelled hours from 18 back to the 20-hour package', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'membership-user-1',
        remainingSessions: 18,
        endDate: new Date('2099-09-30T00:00:00.000Z'),
        membership: { sessions: 20 },
      },
    ])
    const update = vi.fn().mockResolvedValue({})
    const tx = {
      membershipUser: { findMany, update },
    } as unknown as Prisma.TransactionClient

    const restoredHours = await restoreMembershipHoursForBooking(tx, {
      userId: 'user-1',
      createdAt: new Date('2026-09-13T00:00:00.000Z'),
      courtNormalPrice: 0,
      details: [{ slot: oneHourSlot }, { slot: oneHourSlot }],
    })

    expect(restoredHours).toBe(2)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'membership-user-1' },
      data: {
        remainingSessions: { increment: 2 },
        isExpired: false,
      },
    })
  })

  it('does not restore hours for a booking paid without membership', async () => {
    const findMany = vi.fn()
    const update = vi.fn()
    const tx = {
      membershipUser: { findMany, update },
    } as unknown as Prisma.TransactionClient

    const restoredHours = await restoreMembershipHoursForBooking(tx, {
      userId: 'user-1',
      createdAt: new Date('2026-09-13T00:00:00.000Z'),
      courtNormalPrice: 100_000,
      details: [{ slot: oneHourSlot }],
    })

    expect(restoredHours).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('restores only the slot explicitly covered by membership in a mixed booking', async () => {
    const update = vi.fn().mockResolvedValue({})
    const tx = {
      membershipUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'membership-user-1',
          remainingSessions: 9,
          endDate: new Date('2099-09-30T00:00:00.000Z'),
          membership: { sessions: 10, type: 'HAPPY_HOUR' },
        }),
        update,
      },
    } as unknown as Prisma.TransactionClient

    const restoredHours = await restoreMembershipHoursForBooking(tx, {
      userId: 'user-1',
      createdAt: new Date('2026-09-13T00:00:00.000Z'),
      courtNormalPrice: 300_000,
      details: [
        { membershipUserId: 'membership-user-1', slot: oneHourSlot },
        {
          membershipUserId: null,
          slot: {
            startAt: new Date('2026-09-20T09:00:00.000Z'),
            endAt: new Date('2026-09-20T10:00:00.000Z'),
          },
        },
      ],
    })

    expect(restoredHours).toBe(1)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'membership-user-1' },
      data: {
        remainingSessions: { increment: 1 },
        isExpired: false,
      },
    })
  })

  it('deducts only the extra hour when rescheduled to a longer slot', async () => {
    const update = vi.fn().mockResolvedValue({})
    const tx = {
      membershipUser: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'membership-user-1',
            remainingSessions: 18,
            endDate: new Date('2099-09-30T00:00:00.000Z'),
            membership: { sessions: 20 },
          },
        ]),
        update,
      },
    } as unknown as Prisma.TransactionClient

    const difference = await adjustMembershipHoursForReschedule(
      tx,
      {
        userId: 'user-1',
        createdAt: new Date('2026-09-13T00:00:00.000Z'),
        courtNormalPrice: 0,
        details: [{ slot: oneHourSlot }],
      },
      oneHourSlot,
      {
        startAt: oneHourSlot.startAt,
        endAt: new Date('2026-09-20T10:00:00.000Z'),
      },
    )

    expect(difference).toBe(1)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'membership-user-1' },
      data: { remainingSessions: 17, isExpired: false },
    })
  })
})
