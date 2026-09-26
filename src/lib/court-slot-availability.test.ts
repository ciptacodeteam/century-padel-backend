import { describe, expect, it } from 'vitest'
import { withSlotBookingStatus } from './court-slot-availability'

describe('withSlotBookingStatus', () => {
  it('marks a slot held by an unpaid booking as on hold', () => {
    expect(
      withSlotBookingStatus({
        id: 'slot-1',
        isAvailable: false,
        bookingDetails: [{ id: 'detail-1' }],
      }),
    ).toEqual({
      id: 'slot-1',
      isAvailable: false,
      bookingStatus: 'HOLD',
    })
  })

  it('leaves an open slot bookable', () => {
    expect(
      withSlotBookingStatus({
        id: 'slot-2',
        isAvailable: true,
        bookingDetails: [],
      }),
    ).toEqual({
      id: 'slot-2',
      isAvailable: true,
      bookingStatus: null,
    })
  })
})
