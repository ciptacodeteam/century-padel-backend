import { describe, expect, it } from 'vitest'
import { bookingPaymentTypeWhere } from './booking-payment-type.service'

describe('booking payment type filter', () => {
  it('matches explicit and legacy membership bookings', () => {
    expect(bookingPaymentTypeWhere('membership')).toEqual({
      OR: [
        {
          details: {
            some: { membershipUserId: { not: null } },
          },
        },
        {
          courtNormalPrice: 0,
          details: { some: {} },
        },
      ],
    })
  })

  it('defines regular bookings as the inverse of membership bookings', () => {
    expect(bookingPaymentTypeWhere('regular')).toEqual({
      NOT: bookingPaymentTypeWhere('membership'),
    })
  })
})
