import { describe, expect, it } from 'vitest'

import {
  CUSTOMER_RESCHEDULE_MIN_HOURS,
  canCustomerReschedule,
} from './reschedule-policy'

describe('customer reschedule policy', () => {
  const slotStart = new Date('2026-09-15T15:00:00+07:00')

  it('allows rescheduling exactly 48 hours before the slot starts', () => {
    expect(
      canCustomerReschedule(slotStart, new Date('2026-09-13T15:00:00+07:00')),
    ).toBe(true)
  })

  it('rejects rescheduling less than 48 hours before the slot starts', () => {
    expect(
      canCustomerReschedule(
        slotStart,
        new Date('2026-09-13T15:00:00.001+07:00'),
      ),
    ).toBe(false)
  })

  it('defines H-2 as 48 hours', () => {
    expect(CUSTOMER_RESCHEDULE_MIN_HOURS).toBe(48)
  })
})
