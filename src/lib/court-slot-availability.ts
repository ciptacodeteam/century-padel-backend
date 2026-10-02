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
            cancelledAt: null,
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
            cancelledAt: null,
            booking: {
              status: BookingStatus.HOLD,
            },
          },
          none: {
            cancelledAt: null,
            booking: {
              status: BookingStatus.CONFIRMED,
            },
          },
        },
      },
    ],
  }
}

/**
 * Public timetable visibility with an authenticated-user exception: confirmed
 * slots stay hidden unless they belong to the requesting user.
 */
export function visibleCourtSlotWhereForUser(userId?: string) {
  const visibility = openOrHeldCourtSlotWhere()

  if (!userId) return visibility

  return {
    OR: [
      ...visibility.OR,
      {
        bookingDetails: {
          some: {
            cancelledAt: null,
            booking: {
              userId,
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
    cancelledAt: null,
    booking: {
      status: BookingStatus.HOLD,
    },
  },
  select: {
    id: true,
  },
  take: 1,
} as const

export function visibleBookingDetailsInclude(userId?: string) {
  return {
    where: {
      cancelledAt: null,
      booking: {
        OR: [
          { status: BookingStatus.HOLD },
          ...(userId ? [{ status: BookingStatus.CONFIRMED, userId }] : []),
        ],
      },
    },
    select: {
      id: true,
      booking: {
        select: {
          status: true,
          userId: true,
        },
      },
    },
  } as const
}

export function withSlotBookingStatus<
  T extends {
    isAvailable: boolean
    bookingDetails?: {
      id: string
      booking?: { status: BookingStatus; userId: string }
    }[]
  },
>(slot: T, userId?: string) {
  const { bookingDetails, ...rest } = slot
  const onHold =
    bookingDetails?.some(
      (detail) =>
        !detail.booking || detail.booking.status === BookingStatus.HOLD,
    ) ?? false
  const isMyBooking =
    !!userId &&
    (bookingDetails?.some(
      (detail) =>
        detail.booking?.status === BookingStatus.CONFIRMED &&
        detail.booking.userId === userId,
    ) ??
      false)

  return {
    ...rest,
    isAvailable: onHold || isMyBooking ? false : slot.isAvailable,
    bookingStatus: onHold ? ('HOLD' as const) : null,
    isMyBooking,
  }
}
