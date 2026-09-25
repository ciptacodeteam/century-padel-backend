import { MembershipType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  allocateMembershipSlots,
  canMembershipUseSlots,
} from './membership-eligibility.service'

const slotAtJakartaTime = (hour: number, minute = 0) => ({
  startAt: new Date(
    `2026-09-24T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`,
  ),
})

describe('membership slot eligibility', () => {
  it('allows all-hour memberships at happy and peak hours', () => {
    expect(
      canMembershipUseSlots(MembershipType.ALL_HOUR, [
        slotAtJakartaTime(8),
        slotAtJakartaTime(19),
      ]),
    ).toBe(true)
  })

  it('allows peak-hour memberships at happy and peak hours', () => {
    expect(
      canMembershipUseSlots(MembershipType.PEAK_HOUR, [
        slotAtJakartaTime(8),
        slotAtJakartaTime(19),
      ]),
    ).toBe(true)
  })

  it('prevents happy-hour memberships from covering peak-hour slots', () => {
    expect(
      canMembershipUseSlots(MembershipType.HAPPY_HOUR, [slotAtJakartaTime(8)]),
    ).toBe(true)
    expect(
      canMembershipUseSlots(MembershipType.HAPPY_HOUR, [
        slotAtJakartaTime(8),
        slotAtJakartaTime(16),
      ]),
    ).toBe(false)
    expect(
      canMembershipUseSlots(MembershipType.HAPPY_HOUR, [
        slotAtJakartaTime(15, 59),
      ]),
    ).toBe(true)
  })
})

describe('partial membership allocation', () => {
  it('covers happy hour and leaves peak hour payable for a happy-hour package', () => {
    const result = allocateMembershipSlots(MembershipType.HAPPY_HOUR, 1, [
      {
        id: 'happy',
        ...slotAtJakartaTime(15),
        endAt: new Date('2026-09-24T16:00:00+07:00'),
      },
      {
        id: 'peak',
        ...slotAtJakartaTime(16),
        endAt: new Date('2026-09-24T17:00:00+07:00'),
      },
    ])

    expect([...result.slotIds]).toEqual(['happy'])
    expect(result.hours).toBe(1)
  })
})
