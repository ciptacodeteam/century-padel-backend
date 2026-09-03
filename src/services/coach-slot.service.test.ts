import { describe, expect, it } from 'vitest'
import {
  assertCoachSlotSelectionValid,
  CoachSlotForBooking,
  timeRangesOverlap,
} from './coach-slot.service'

const slot = (
  id: string,
  staffId: string,
  startAt: string,
  endAt: string,
): CoachSlotForBooking => ({
  id,
  staffId,
  startAt: new Date(startAt),
  endAt: new Date(endAt),
  price: 100_000,
  isAvailable: true,
})

describe('coach slot schedule validation', () => {
  it('detects a partial time overlap', () => {
    expect(
      timeRangesOverlap(
        new Date('2026-09-05T10:00:00Z'),
        new Date('2026-09-05T12:00:00Z'),
        new Date('2026-09-05T11:00:00Z'),
        new Date('2026-09-05T13:00:00Z'),
      ),
    ).toBe(true)
  })

  it('allows consecutive slots whose boundaries only touch', () => {
    const slots = [
      slot('slot-1', 'coach-1', '2026-09-05T10:00:00Z', '2026-09-05T11:00:00Z'),
      slot('slot-2', 'coach-1', '2026-09-05T11:00:00Z', '2026-09-05T12:00:00Z'),
    ]

    expect(() =>
      assertCoachSlotSelectionValid(
        slots.map((item) => item.id),
        slots,
      ),
    ).not.toThrow()
  })

  it('rejects overlapping selected slots for the same coach', () => {
    const slots = [
      slot('slot-1', 'coach-1', '2026-09-05T10:00:00Z', '2026-09-05T12:00:00Z'),
      slot('slot-2', 'coach-1', '2026-09-05T11:00:00Z', '2026-09-05T13:00:00Z'),
    ]

    expect(() =>
      assertCoachSlotSelectionValid(
        slots.map((item) => item.id),
        slots,
      ),
    ).toThrow(/overlapping schedule slots/)
  })

  it('allows overlapping times for different coaches', () => {
    const slots = [
      slot('slot-1', 'coach-1', '2026-09-05T10:00:00Z', '2026-09-05T12:00:00Z'),
      slot('slot-2', 'coach-2', '2026-09-05T11:00:00Z', '2026-09-05T13:00:00Z'),
    ]

    expect(() =>
      assertCoachSlotSelectionValid(
        slots.map((item) => item.id),
        slots,
      ),
    ).not.toThrow()
  })
})
