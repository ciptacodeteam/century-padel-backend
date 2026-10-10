import { describe, expect, it, vi } from 'vitest'
import { bulkSlotAvailability } from './bulk-slot-availability.service'

describe('bulk court availability', () => {
  it.each([true, false])(
    'protects booked slots when availability is %s',
    async (available) => {
      const tx = {
        slot: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
          count: vi.fn().mockResolvedValue(2),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }
      expect(
        await bulkSlotAvailability(
          tx as never,
          'court',
          ['a', 'b', 'c', 'a'],
          available,
        ),
      ).toEqual({ updated: 1, skipped: 1, unchanged: 1 })
      expect(tx.slot.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['a', 'b', 'c'] },
          courtId: 'court',
          type: 'COURT',
          isAvailable: !available,
          bookingDetails: {
            none: {
              cancelledAt: null,
              booking: { status: { not: 'CANCELLED' } },
            },
          },
        },
        data: { isAvailable: available },
      })
    },
  )
  it('rejects a missing slot or another court before writing', async () => {
    const tx = {
      slot: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    }
    await expect(
      bulkSlotAvailability(tx as never, 'court', ['other'], false),
    ).rejects.toThrow('do not belong')
    expect(tx.slot.updateMany).not.toHaveBeenCalled()
  })
})
