import { BookingStatus } from '@prisma/client'

/**
 * Open slots, plus slots held by an unpaid booking.
 * Confirmed bookings stay excluded so the timetable can label a hold
 * without treating it as a finished booking.
 */
export function openOrHeldCourtSlotWhere() {
  return {
    OR: [
      {
        isAvailable: true,
        bookingDetails: {
          none: {
            booking: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
          },
        },
      },
      {
        bookingDetails: {
          some: {
            booking: {
              status: BookingStatus.HOLD,
            },
          },
          none: {
            booking: {
              status: BookingStatus.CONFIRMED,
            },
          },
        },
      },
    ],
  }
}

export const heldBookingDetailsInclude = {
  where: {
    booking: {
      status: BookingStatus.HOLD,
    },
  },
  select: {
    id: true,
  },
  take: 1,
} as const

export function withSlotBookingStatus<
  T extends { isAvailable: boolean; bookingDetails?: { id: string }[] },
>(slot: T) {
  const { bookingDetails, ...rest } = slot
  const onHold = (bookingDetails?.length ?? 0) > 0

  return {
    ...rest,
    isAvailable: onHold ? false : slot.isAvailable,
    bookingStatus: onHold ? ('HOLD' as const) : null,
  }
}
