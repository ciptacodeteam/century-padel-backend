import { describe, expect, it } from 'vitest'
import {
  openOrHeldCourtSlotWhere,
  withSlotBookingStatus,
} from './court-slot-availability'

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

  it('ignores cancelled court details when checking availability', () => {
    const where = openOrHeldCourtSlotWhere()
    expect(where.OR[0].bookingDetails.none).toMatchObject({
      cancelledAt: null,
    })
    expect(where.OR[1].bookingDetails.some).toMatchObject({
      cancelledAt: null,
    })
  })
})
