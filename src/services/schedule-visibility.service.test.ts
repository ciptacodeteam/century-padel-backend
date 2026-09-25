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
      new Date('2026-10-22T23:59:59.999Z').toISOString(),
    )
  })

  it('extends horizon by the membership visibility months', () => {
    // 22 Sep 2026 + 4 months → 22 January 2027
    const now = new Date('2026-09-22T10:00:00+07:00')
    const horizon = getScheduleVisibilityHorizonDate(4, now)

    expect(horizon.toISOString()).toBe(
      new Date('2027-01-22T23:59:59.999Z').toISOString(),
    )
  })

  it('keeps every business hour on the horizon day visible', () => {
    const horizon = new Date('2026-10-22T23:59:59.999Z')
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-22T17:00:00Z'),
        horizon,
      ),
    ).toBe(true)
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-22T23:00:00Z'),
        horizon,
      ),
    ).toBe(true)
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-23T00:00:00Z'),
        horizon,
      ),
    ).toBe(false)
  })

  it('does not cut off 25 October slots from 17:00 onward for a logged-in user', () => {
    const now = new Date('2026-09-25T10:00:00+07:00')
    const horizon = getScheduleVisibilityHorizonDate(1, now)

    expect(horizon.toISOString()).toBe('2026-10-25T23:59:59.999Z')
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-25T17:00:00Z'),
        horizon,
      ),
    ).toBe(true)
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-25T23:00:00Z'),
        horizon,
      ),
    ).toBe(true)
    expect(
      isDateWithinScheduleVisibility(
        new Date('2026-10-26T00:00:00Z'),
        horizon,
      ),
    ).toBe(false)
  })
})
