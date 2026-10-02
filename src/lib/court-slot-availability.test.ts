import { describe, expect, it } from 'vitest'
import {
  openOrHeldCourtSlotWhere,
  visibleCourtSlotWhereForUser,
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
      isMyBooking: false,
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
      isMyBooking: false,
    })
  })

  it('marks only the requesting user confirmed booking as theirs', () => {
    expect(
      withSlotBookingStatus(
        {
          id: 'slot-3',
          isAvailable: false,
          bookingDetails: [
            {
              id: 'detail-3',
              booking: { status: 'CONFIRMED', userId: 'user-1' },
            },
          ],
        },
        'user-1',
      ),
    ).toEqual({
      id: 'slot-3',
      isAvailable: false,
      bookingStatus: null,
      isMyBooking: true,
    })
  })

  it('only adds confirmed booking visibility for an authenticated user', () => {
    expect(visibleCourtSlotWhereForUser().OR).toHaveLength(2)
    expect(visibleCourtSlotWhereForUser('user-1').OR).toHaveLength(3)
    expect(visibleCourtSlotWhereForUser('user-1').OR[2]).toMatchObject({
      bookingDetails: {
        some: {
          booking: { userId: 'user-1', status: 'CONFIRMED' },
        },
      },
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
