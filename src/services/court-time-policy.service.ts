export const HAPPY_HOUR_START = 6
export const PEAK_HOUR_START = 16
export const COURT_DAY_END = 24

export type CourtPriceBand = 'HAPPY_HOUR' | 'PEAK_HOUR'

/** JavaScript weekday: Sunday = 0, Saturday = 6. */
export function isWeekendDay(day: number): boolean {
  return day === 0 || day === 6
}

/**
 * Saturday and Sunday are non-peak for every operating hour. Weekdays switch
 * to peak pricing at 16:00.
 */
export function getCourtPriceBand(
  day: number,
  startHour: number,
): CourtPriceBand {
  return isWeekendDay(day) || startHour < PEAK_HOUR_START
    ? 'HAPPY_HOUR'
    : 'PEAK_HOUR'
}
