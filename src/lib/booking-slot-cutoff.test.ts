import {
  getBookableSlotEndThreshold,
  isSlotBeforeBookingCutoff,
} from '@/lib/booking-slot-cutoff'
import { describe, expect, it } from 'vitest'

describe('booking slot cutoff', () => {
  const slotEnd = new Date('2026-09-13T16:00:00.000Z')

  it('keeps a 15:00-16:00 slot bookable through 15:54', () => {
    expect(
      isSlotBeforeBookingCutoff(slotEnd, new Date('2026-09-13T15:54:59.000Z')),
    ).toBe(true)
  })

  it('hides the slot starting at 15:55', () => {
    expect(
      isSlotBeforeBookingCutoff(slotEnd, new Date('2026-09-13T15:55:00.000Z')),
    ).toBe(false)
  })

  it('builds the database threshold five minutes after now', () => {
    expect(
      getBookableSlotEndThreshold(
        new Date('2026-09-13T15:55:00.000Z'),
      ).toISOString(),
    ).toBe('2026-09-13T16:00:00.000Z')
  })
})
