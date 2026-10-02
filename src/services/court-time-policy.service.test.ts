import { describe, expect, it } from 'vitest'
import { getCourtPriceBand } from './court-time-policy.service'

describe('court time policy', () => {
  it('uses non-peak pricing before 16:00 on weekdays', () => {
    expect(getCourtPriceBand(1, 15)).toBe('HAPPY_HOUR')
    expect(getCourtPriceBand(5, 16)).toBe('PEAK_HOUR')
  })

  it('uses non-peak pricing for every hour on Saturday and Sunday', () => {
    expect(getCourtPriceBand(6, 6)).toBe('HAPPY_HOUR')
    expect(getCourtPriceBand(6, 23)).toBe('HAPPY_HOUR')
    expect(getCourtPriceBand(0, 6)).toBe('HAPPY_HOUR')
    expect(getCourtPriceBand(0, 23)).toBe('HAPPY_HOUR')
  })
})
