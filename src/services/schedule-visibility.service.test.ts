import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_SCHEDULE_VISIBILITY_MONTHS,
  getScheduleVisibilityHorizonDate,
  isDateWithinScheduleVisibility,
} from './schedule-visibility.service'

describe('schedule-visibility.service', () => {
  it('defaults guest visibility to 1 month ending at end of next calendar month', () => {
    // 22 Sep 2026 Jakarta → visibility 1 month → 31 Oct 2026
    const now = new Date('2026-09-22T10:00:00+07:00')
    const horizon = getScheduleVisibilityHorizonDate(
      DEFAULT_SCHEDULE_VISIBILITY_MONTHS,
      now,
    )

    expect(horizon.toISOString()).toBe(
      new Date('2026-10-31T23:59:59.999+07:00').toISOString(),
    )
  })

  it('extends horizon by membership months to end of that calendar month', () => {
    // 22 Sep 2026 + 4 months → end of January 2027
    const now = new Date('2026-09-22T10:00:00+07:00')
    const horizon = getScheduleVisibilityHorizonDate(4, now)

    expect(horizon.toISOString()).toBe(
      new Date('2027-01-31T23:59:59.999+07:00').toISOString(),
    )
  })

  it('treats dates on the horizon day as visible', () => {
    const horizon = new Date('2026-10-31T23:59:59.999+07:00')
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-31T08:00:00+07:00'),
        horizon,
      ),
    ).toBe(true)
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-11-01T00:00:00+07:00'),
        horizon,
      ),
    ).toBe(false)
  })
})
