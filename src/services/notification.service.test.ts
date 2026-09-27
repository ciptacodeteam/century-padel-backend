import { createBookingCancellationNotification } from '@/services/notification.service'
import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

describe('booking cancellation notification', () => {
  it('stores invoice, court schedule, reason, and restored membership hours', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'notification-1' })
    const tx = {
      notification: { create },
    } as unknown as Prisma.TransactionClient

    await createBookingCancellationNotification(tx, {
      userId: 'user-1',
      bookingId: 'booking-1',
      invoiceNumber: 'INV-001',
      reason: 'Salah memilih waktu',
      restoredMembershipHours: 2,
      courtSlots: [
        {
          courtName: 'Court 2',
          startAt: new Date('2026-10-01T15:00:00.000Z'),
          endAt: new Date('2026-10-01T16:00:00.000Z'),
        },
        {
          courtName: 'Court 2',
          startAt: new Date('2026-10-01T16:00:00.000Z'),
          endAt: new Date('2026-10-01T17:00:00.000Z'),
        },
      ],
    })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        title: 'Booking Lapangan Dibatalkan',
        message:
          'Court 2, 01/10/2026 15:00–16:00 dan 1 slot lainnya telah dibatalkan.',
        data: {
          event: 'BOOKING_CANCELLED',
          bookingId: 'booking-1',
          invoiceNumber: 'INV-001',
          reason: 'Salah memilih waktu',
          restoredMembershipHours: 2,
          courtSlots: [
            {
              courtName: 'Court 2',
              startAt: '2026-10-01T15:00:00.000Z',
              endAt: '2026-10-01T16:00:00.000Z',
            },
            {
              courtName: 'Court 2',
              startAt: '2026-10-01T16:00:00.000Z',
              endAt: '2026-10-01T17:00:00.000Z',
            },
          ],
        },
      }),
    })
  })
})
