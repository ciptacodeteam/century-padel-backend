import { describe, expect, it } from 'vitest'
import { buildMembershipActivity } from './membership-activity.service'

type Record = Parameters<typeof buildMembershipActivity>[0][number]
const day = (value: number) =>
  new Date(`2026-10-${String(value).padStart(2, '0')}T10:00:00Z`)
const record = (overrides: Partial<Record> = {}): Record =>
  ({
    id: 'package-1',
    acquisitionType: 'PURCHASE',
    createdAt: day(1),
    startDate: day(1),
    endDate: day(30),
    remainingSessions: 12,
    isExpired: false,
    isSuspended: false,
    membership: { name: '20 Jam', sessions: 20, benefits: [] },
    invoice: { number: 'INV-1', status: 'PAID', paidAt: day(1) },
    incomingTransfer: null,
    outgoingTransfers: [],
    bookingDetails: [],
    ...overrides,
  }) as Record
const transfer = (cancelledAt: Date | null = null) => ({
  id: 'transfer-1',
  reason: 'Transfer',
  sourceMembershipUserId: 'package-1',
  destinationMembershipUserId: 'received',
  fromUserId: 'sender',
  toUserId: 'recipient',
  transferredByAdminId: 'admin',
  cancellationReason: null,
  cancelledByAdminId: null,
  transferredHours: 4,
  createdAt: day(3),
  cancelledAt,
  toUser: { name: 'Budi' },
  fromUser: { name: 'Andi' },
})
const detail = (
  id: string,
  status = 'CONFIRMED',
  cancelledAt: Date | null = null,
) => ({
  id,
  bookingId: `booking-${id}`,
  createdAt: day(2),
  cancelledAt,
  court: { name: 'Court 1' },
  slot: { startAt: day(5), endAt: new Date(day(5).getTime() + 2 * 3600000) },
  booking: {
    status,
    cancelledAt: status === 'CANCELLED' ? day(6) : null,
    invoice: { number: `INV-${id}` },
  },
})

describe('customer membership hour activity', () => {
  it('separates bookings, payment holds, transfers and unattributed legacy deductions', () => {
    const result = buildMembershipActivity(
      [
        record({
          outgoingTransfers: [transfer()] as Record['outgoingTransfers'],
          bookingDetails: [
            detail('paid'),
            detail('hold', 'HOLD'),
          ] as Record['bookingDetails'],
        }),
      ],
      day(20),
    )
    expect(result.memberships[0]).toMatchObject({
      allocatedHours: 20,
      remainingHours: 12,
      bookingHours: 2,
      heldHours: 2,
      transferredOutHours: 4,
      untrackedHours: 0,
      status: 'ACTIVE',
    })
    expect(
      result.events.find((event) => event.type === 'TRANSFER_OUT'),
    ).toMatchObject({
      title: 'Transfer ke Budi',
      hours: -4,
      membershipUserId: 'package-1',
    })
    expect(
      result.events.find((event) => event.id === 'booking-hold')?.status,
    ).toBe('HOLD')
    const legacy = buildMembershipActivity([record()], day(20))
    expect(legacy.memberships[0].untrackedHours).toBe(8)
    expect(legacy.memberships[0].bookingHours).toBe(0)
  })

  it('shows both sides of a cancelled transfer without counting it as booking use', () => {
    const cancelled = transfer(day(7))
    const result = buildMembershipActivity(
      [
        record({
          remainingSessions: 20,
          outgoingTransfers: [cancelled] as Record['outgoingTransfers'],
        }),
        record({
          id: 'received',
          acquisitionType: 'TRANSFER',
          remainingSessions: 0,
          invoice: null,
          incomingTransfer: cancelled as Record['incomingTransfer'],
          isExpired: true,
        }),
      ],
      day(20),
    )
    expect(result.memberships[0]).toMatchObject({
      transferredOutHours: 0,
      untrackedHours: 0,
      bookingHours: 0,
    })
    expect(result.memberships[1]).toMatchObject({
      allocatedHours: 4,
      transferredInHours: 0,
      status: 'CANCELLED',
      untrackedHours: 0,
    })
    for (const id of ['package-1', 'received']) {
      const moves = result.events.filter(
        (event) => event.membershipUserId === id && event.type !== 'PURCHASE',
      )
      expect(moves).toHaveLength(2)
      expect(moves.reduce((sum, event) => sum + event.hours, 0)).toBe(0)
    }
  })

  it('keeps cancelled booking and its return, excluding cancelled details from usage', () => {
    const result = buildMembershipActivity(
      [
        record({
          remainingSessions: 20,
          bookingDetails: [
            detail('partial', 'CONFIRMED', day(6)),
            detail('whole', 'CANCELLED'),
          ] as Record['bookingDetails'],
        }),
      ],
      day(20),
    )
    expect(result.memberships[0]).toMatchObject({
      bookingHours: 0,
      heldHours: 0,
      untrackedHours: 0,
    })
    const bookingEvents = result.events.filter(
      (event) => event.type !== 'PURCHASE',
    )
    expect(bookingEvents).toHaveLength(4)
    expect(bookingEvents.reduce((sum, event) => sum + event.hours, 0)).toBe(0)
  })

  it('retains expired and exhausted packages, uses incoming allocation, and omits unpaid purchases', () => {
    const result = buildMembershipActivity(
      [
        record({ isExpired: true, remainingSessions: 0 }),
        record({ id: 'expired', endDate: day(10) }),
        record({
          id: 'received',
          acquisitionType: 'TRANSFER',
          invoice: null,
          remainingSessions: 4,
          incomingTransfer: transfer() as Record['incomingTransfer'],
        }),
        record({
          id: 'unpaid',
          invoice: { number: 'PENDING', status: 'PENDING', paidAt: null },
        }),
      ],
      day(20),
    )
    expect(result.memberships.map((membership) => membership.id)).toEqual([
      'package-1',
      'expired',
      'received',
    ])
    expect(result.memberships[0].status).toBe('EXPIRED')
    expect(result.memberships[1].status).toBe('EXPIRED')
    expect(result.memberships[2]).toMatchObject({
      allocatedHours: 4,
      transferredInHours: 4,
      untrackedHours: 0,
    })
    expect(result.events[0]).toMatchObject({
      type: 'TRANSFER_IN',
      counterpart: 'Andi',
      hours: 4,
    })
    expect(
      result.events.some((event) => event.membershipUserId === 'unpaid'),
    ).toBe(false)
  })
})
