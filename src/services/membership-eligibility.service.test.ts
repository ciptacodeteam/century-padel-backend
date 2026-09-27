import { MembershipType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  allocateMembershipSlots,
  allocateSlotsAcrossMemberships,
  canMembershipUseSlots,
} from './membership-eligibility.service'

const slotAtJakartaTime = (hour: number, minute = 0) => ({
  startAt: new Date(
    // Slot records preserve the Jakarta wall-clock components in UTC.
    `2026-09-24T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
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
        endAt: new Date('2026-09-24T16:00:00Z'),
      },
      {
        id: 'peak',
        ...slotAtJakartaTime(16),
        endAt: new Date('2026-09-24T17:00:00Z'),
      },
    ])

    expect([...result.slotIds]).toEqual(['happy'])
    expect(result.hours).toBe(1)
  })

  it('uses happy hour first and all hour for the peak slot', () => {
    const result = allocateSlotsAcrossMemberships(
      [
        {
          id: 'all-hour',
          remainingSessions: 10,
          endDate: new Date('2026-12-31T00:00:00Z'),
          membership: { type: MembershipType.ALL_HOUR },
        },
        {
          id: 'happy-hour',
          remainingSessions: 10,
          endDate: new Date('2026-12-31T00:00:00Z'),
          membership: { type: MembershipType.HAPPY_HOUR },
        },
      ],
      [
        {
          id: 'slot-15',
          ...slotAtJakartaTime(15),
          endAt: new Date('2026-09-24T16:00:00Z'),
        },
        {
          id: 'slot-16',
          ...slotAtJakartaTime(16),
          endAt: new Date('2026-09-24T17:00:00Z'),
        },
      ],
    )

    expect(result?.slotMembershipIds).toEqual(
      new Map([
        ['slot-15', 'happy-hour'],
        ['slot-16', 'all-hour'],
      ]),
    )
  })

  it('honors an explicit membership choice per slot', () => {
    const slots = [
      {
        id: 'slot-15',
        ...slotAtJakartaTime(15),
        endAt: new Date('2026-09-24T16:00:00Z'),
      },
    ]
    const result = allocateSlotsAcrossMemberships(
      [
        {
          id: 'all-hour',
          remainingSessions: 10,
          endDate: new Date('2026-12-31T00:00:00Z'),
          membership: { type: MembershipType.ALL_HOUR },
        },
        {
          id: 'happy-hour',
          remainingSessions: 10,
          endDate: new Date('2026-12-31T00:00:00Z'),
          membership: { type: MembershipType.HAPPY_HOUR },
        },
      ],
      slots,
      undefined,
      [{ slotId: 'slot-15', membershipUserId: 'all-hour' }],
    )

    expect(result?.slotMembershipIds.get('slot-15')).toBe('all-hour')
  })
})
