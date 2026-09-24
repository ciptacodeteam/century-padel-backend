import { MembershipType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  allocateMembershipSlots,
  canMembershipUseSlots,
} from './membership-eligibility.service'

const slotAtJakartaHour = (hour: number) => ({
  startAt: new Date(`2026-09-24T${String(hour).padStart(2, '0')}:00:00+07:00`),
})

describe('membership slot eligibility', () => {
  it('allows all-hour memberships at happy and peak hours', () => {
    expect(
      canMembershipUseSlots(MembershipType.ALL_HOUR, [
        slotAtJakartaHour(8),
        slotAtJakartaHour(19),
      ]),
    ).toBe(true)
  })

  it('allows peak-hour memberships at happy and peak hours', () => {
    expect(
      canMembershipUseSlots(MembershipType.PEAK_HOUR, [
        slotAtJakartaHour(8),
        slotAtJakartaHour(19),
      ]),
    ).toBe(true)
  })

  it('prevents happy-hour memberships from covering peak-hour slots', () => {
    expect(
      canMembershipUseSlots(MembershipType.HAPPY_HOUR, [slotAtJakartaHour(8)]),
    ).toBe(true)
    expect(
      canMembershipUseSlots(MembershipType.HAPPY_HOUR, [
        slotAtJakartaHour(8),
        slotAtJakartaHour(15),
      ]),
    ).toBe(false)
  })
})

describe('partial membership allocation', () => {
  it('covers happy hour and leaves peak hour payable for a happy-hour package', () => {
    const result = allocateMembershipSlots(MembershipType.HAPPY_HOUR, 1, [
      {
        id: 'happy',
        ...slotAtJakartaHour(14),
        endAt: new Date('2026-09-24T15:00:00+07:00'),
      },
      {
        id: 'peak',
        ...slotAtJakartaHour(15),
        endAt: new Date('2026-09-24T16:00:00+07:00'),
      },
    ])

    expect([...result.slotIds]).toEqual(['happy'])
    expect(result.hours).toBe(1)
  })
})
