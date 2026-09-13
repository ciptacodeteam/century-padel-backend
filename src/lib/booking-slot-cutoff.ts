import dayjs from 'dayjs'

export const BOOKING_SLOT_CUTOFF_MINUTES_BEFORE_END = 5

export function getBookableSlotEndThreshold(now: Date = new Date()): Date {
  return dayjs(now)
    .add(BOOKING_SLOT_CUTOFF_MINUTES_BEFORE_END, 'minute')
    .toDate()
}

export function isSlotBeforeBookingCutoff(
  endAt: Date,
  now: Date = new Date(),
): boolean {
  return dayjs(now).isBefore(
    dayjs(endAt).subtract(BOOKING_SLOT_CUTOFF_MINUTES_BEFORE_END, 'minute'),
  )
}
