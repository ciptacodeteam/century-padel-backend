import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCHEDULE_VISIBILITY_MONTHS,
  getScheduleVisibilityHorizonDate,
  isDateWithinScheduleVisibility,
} from './schedule-visibility.service'

describe('schedule-visibility.service', () => {
  it('defaults guest visibility to exactly 1 month ahead', () => {
    // 22 Sep 2026 Jakarta → visibility 1 month → 22 Oct 2026
    const now = new Date('2026-09-22T10:00:00+07:00')
    const horizon = getScheduleVisibilityHorizonDate(
      DEFAULT_SCHEDULE_VISIBILITY_MONTHS,
      now,
    )

    expect(horizon.toISOString()).toBe(
      new Date('2026-10-22T23:59:59.999+07:00').toISOString(),
    )
  })

  it('extends horizon by the membership visibility months', () => {
    // 22 Sep 2026 + 4 months → 22 January 2027
    const now = new Date('2026-09-22T10:00:00+07:00')
    const horizon = getScheduleVisibilityHorizonDate(4, now)

    expect(horizon.toISOString()).toBe(
      new Date('2027-01-22T23:59:59.999+07:00').toISOString(),
    )
  })

  it('treats dates on the horizon day as visible', () => {
    const horizon = new Date('2026-10-22T23:59:59.999+07:00')
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-22T08:00:00+07:00'),
        horizon,
      ),
    ).toBe(true)
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-23T00:00:00+07:00'),
        horizon,
      ),
    ).toBe(false)
  })
})
