import { releaseBookingSlots } from '@/services/booking-resource.service'
import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

describe('releaseBookingSlots', () => {
  it('makes every court, coach, and ballboy slot available again', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 })
    const tx = {
      bookingDetail: {
        findMany: vi.fn().mockResolvedValue([{ slotId: 'court-slot' }]),
      },
      bookingCoach: {
        findMany: vi.fn().mockResolvedValue([{ slotId: 'coach-slot' }]),
      },
      bookingBallboy: {
        findMany: vi.fn().mockResolvedValue([{ slotId: 'ballboy-slot' }]),
      },
      slot: { updateMany },
    } as unknown as Prisma.TransactionClient

    const released = await releaseBookingSlots(tx, 'booking-1')

    expect(released).toBe(3)
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['court-slot', 'coach-slot', 'ballboy-slot'] },
      },
      data: { isAvailable: true },
    })
  })
})
