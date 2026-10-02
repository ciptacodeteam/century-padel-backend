import { Prisma } from '@prisma/client'

export type BookingPaymentType = 'membership' | 'regular'

const membershipBookingWhere: Prisma.BookingWhereInput = {
  OR: [
    {
      details: {
        some: { membershipUserId: { not: null } },
      },
    },
    {
      // Older membership bookings did not persist membershipUserId on each
      // booking detail. For those records, a court booking with zero normal
      // court price is the legacy membership marker.
      courtNormalPrice: 0,
      details: { some: {} },
    },
  ],
}

export function bookingPaymentTypeWhere(
  paymentType: BookingPaymentType,
): Prisma.BookingWhereInput {
  return paymentType === 'membership'
    ? membershipBookingWhere
    : { NOT: membershipBookingWhere }
}
