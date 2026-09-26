import { BadRequestException } from '@/exceptions'
import {
  consumeComplimentaryCredits,
  getSlotDurationMinutes,
  getTotalSlotDurationMinutes,
  restoreComplimentaryCreditsForBooking,
} from '@/services/complimentary-credit.service'
import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

describe('complimentary credit', () => {
  it('calculates exact court duration in minutes', () => {
    const slots = [
      {
        startAt: new Date('2026-10-25T10:00:00.000Z'),
        endAt: new Date('2026-10-25T11:30:00.000Z'),
      },
      {
        startAt: new Date('2026-10-25T12:00:00.000Z'),
        endAt: new Date('2026-10-25T13:00:00.000Z'),
      },
    ]

    expect(getSlotDurationMinutes(slots[0])).toBe(90)
    expect(getTotalSlotDurationMinutes(slots)).toBe(150)
  })

  it('consumes grants that expire first and records an audit entry', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const create = vi.fn().mockResolvedValue({})
    const tx = {
      complimentaryCredit: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'first', remainingMinutes: 60 },
          { id: 'second', remainingMinutes: 120 },
        ]),
        updateMany,
      },
      complimentaryCreditTransaction: { create },
      booking: { update: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient

    await expect(
      consumeComplimentaryCredits(tx, {
        userId: 'user-1',
        bookingId: 'booking-1',
        requiredMinutes: 90,
      }),
    ).resolves.toBe(90)

    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenNthCalledWith(1, {
      data: {
        creditId: 'first',
        bookingId: 'booking-1',
        type: 'REDEEM',
        minutes: 60,
        staffId: undefined,
      },
    })
    expect(create).toHaveBeenNthCalledWith(2, {
      data: {
        creditId: 'second',
        bookingId: 'booking-1',
        type: 'REDEEM',
        minutes: 30,
        staffId: undefined,
      },
    })
  })

  it('rejects checkout before mutating when the full duration is not covered', async () => {
    const updateMany = vi.fn()
    const tx = {
      complimentaryCredit: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'credit', remainingMinutes: 30 }]),
        updateMany,
      },
      complimentaryCreditTransaction: { create: vi.fn() },
      booking: { update: vi.fn() },
    } as unknown as Prisma.TransactionClient

    await expect(
      consumeComplimentaryCredits(tx, {
        userId: 'user-1',
        bookingId: 'booking-1',
        requiredMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('restores redeemed minutes and skips an already refunded booking', async () => {
    const update = vi.fn().mockResolvedValue({})
    const create = vi.fn().mockResolvedValue({})
    const tx = {
      complimentaryCredit: { update },
      complimentaryCreditTransaction: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { creditId: 'credit-1', type: 'REDEEM', minutes: 90 },
          ])
          .mockResolvedValueOnce([
            { creditId: 'credit-1', type: 'REDEEM', minutes: 90 },
            { creditId: 'credit-1', type: 'REFUND', minutes: 90 },
          ]),
        create,
      },
      booking: {
        updateMany: vi
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    } as unknown as Prisma.TransactionClient

    await expect(
      restoreComplimentaryCreditsForBooking(tx, 'booking-1'),
    ).resolves.toBe(90)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'credit-1' },
      data: { remainingMinutes: { increment: 90 } },
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        creditId: 'credit-1',
        bookingId: 'booking-1',
        type: 'REFUND',
        minutes: 90,
        staffId: undefined,
        note: 'Restored after booking cancellation',
      },
    })

    await expect(
      restoreComplimentaryCreditsForBooking(tx, 'booking-1'),
    ).resolves.toBe(0)
    expect(update).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
