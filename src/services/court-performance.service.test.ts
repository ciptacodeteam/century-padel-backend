import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ db: {} }))
import {
  aggregateCourtPerformance,
  reportBounds,
} from './court-performance.service'

const pkg = {
  id: 'all-200',
  name: 'All Day 200 Hours',
  type: 'ALL_HOUR',
  sessions: 200,
}
const unused = { ...pkg, id: 'all-50', name: 'All Day 50 Hours', sessions: 50 }
const { start, end } = reportBounds('2026-10-01', '2026-10-31')
type Slot = Parameters<typeof aggregateCourtPerformance>[0][number]
type Detail = Slot['bookingDetails'][number]
function detail(patch: Partial<Detail> = {}): Detail {
  return {
    id: 'detail-1',
    price: 600000,
    complimentaryCreditMinutes: 0,
    cancelledAt: null,
    membershipUser: null,
    booking: {
      id: 'booking-1',
      status: 'CONFIRMED',
      createdAt: new Date('2026-09-20T08:00:00Z'),
      courtNormalPrice: 600000,
      user: { id: 'user-1', name: 'Andi' },
      invoice: { id: 'inv-1', number: 'INV-001' },
    },
    ...patch,
  }
}
function slot(patch: Partial<Slot> = {}): Slot {
  return {
    id: 'slot-1',
    startAt: new Date('2026-10-08T15:00:00Z'),
    endAt: new Date('2026-10-08T17:00:00Z'),
    isAvailable: false,
    court: { id: 'court-1', name: 'Court 1' },
    bookingDetails: [detail()],
    ...patch,
  }
}
const report = (slots: Slot[], now = new Date('2026-11-01T00:00:00Z')) =>
  aggregateCourtPerformance(slots, [pkg, unused], start, end, now)

describe('court performance', () => {
  it('splits weekday peak boundaries and reconciles normal prices and details', () => {
    const result = report([slot()])
    expect(result.rows.find((r) => r.id === 'regular:non-peak')?.hours).toBe(1)
    expect(result.rows.find((r) => r.id === 'regular:peak')?.hours).toBe(1)
    expect(result.details.map((d) => d.normalValue)).toEqual([300000, 300000])
    expect(result.summary.hours).toBe(2)
    expect(result.summary.occupancy).toBe(100)
    expect(result.details.reduce((sum, d) => sum + d.hours, 0)).toBe(
      result.summary.hours,
    )
    expect(
      result.rows.find((r) => r.id === `membership:${unused.id}`)?.hours,
    ).toBe(0)
  })
  it('uses play dates, keeps membership identity, and counts multiple courts independently', () => {
    const second = detail({
      id: 'detail-2',
      membershipUser: { membership: pkg },
    })
    const result = report([
      slot(),
      slot({
        id: 'slot-2',
        court: { id: 'court-2', name: 'Court 2' },
        bookingDetails: [second],
      }),
    ])
    expect(result.summary.hours).toBe(4)
    expect(result.summary.membershipHours).toBe(2)
    expect(
      result.rows.find((r) => r.id === `membership:${pkg.id}`)?.bookings,
    ).toBe(1)
    expect(result.details[0].bookedAt).toContain('2026-09-20')
  })
  it('attributes separate slots in one booking to the actual packages', () => {
    const result = report([
      slot({
        bookingDetails: [detail({ membershipUser: { membership: pkg } })],
      }),
      slot({
        id: 'slot-2',
        bookingDetails: [
          detail({ id: 'detail-2', membershipUser: { membership: unused } }),
        ],
      }),
    ])
    expect(
      result.rows.filter((r) => r.kind === 'membership').map((r) => r.hours),
    ).toEqual([2, 2])
  })
  it('excludes cancelled details and cancelled/hold bookings from usage, but keeps held capacity', () => {
    const cancelled = detail({ cancelledAt: new Date() })
    const held = detail()
    held.booking.status = 'HOLD'
    const cancelledBooking = detail()
    cancelledBooking.booking.status = 'CANCELLED'
    const result = report([
      slot({ bookingDetails: [cancelled] }),
      slot({ id: 'held', bookingDetails: [held] }),
      slot({ id: 'cancelled', bookingDetails: [cancelledBooking] }),
    ])
    expect(result.summary.hours).toBe(0)
    expect(result.summary.availableHours).toBe(2)
  })
  it('keeps free/legacy and complimentary bookings out of normal paid categories', () => {
    const legacy = detail()
    legacy.booking.courtNormalPrice = 0
    const result = report([
      slot({ bookingDetails: [legacy] }),
      slot({
        id: 'free',
        bookingDetails: [detail({ complimentaryCreditMinutes: 120 })],
      }),
    ])
    expect(result.summary.regularHours).toBe(0)
    expect(result.summary.membershipHours).toBe(0)
    expect(result.rows.find((r) => r.id === 'unverified')?.hours).toBe(2)
    expect(result.rows.find((r) => r.id === 'complimentary')?.hours).toBe(2)
  })
  it('treats weekend evening as non-peak', () => {
    const result = report([
      slot({
        startAt: new Date('2026-10-10T19:00:00Z'),
        endAt: new Date('2026-10-10T20:00:00Z'),
      }),
    ])
    expect(result.rows.find((r) => r.id === 'regular:non-peak')?.hours).toBe(1)
    expect(result.rows.find((r) => r.id === 'regular:peak')?.hours).toBe(0)
  })
  it('compares Jakarta now with stored wall-clock schedules, including partial hours', () => {
    const result = report([slot()], new Date('2026-10-08T08:30:00Z'))
    expect(result.summary.elapsedHours).toBe(0.5)
    expect(result.summary.upcomingHours).toBe(1.5)
  })
  it('clips durations and value to inclusive date range without rounding to package debit units', () => {
    const result = report([
      slot({
        startAt: new Date('2026-09-30T23:30:00Z'),
        endAt: new Date('2026-10-01T00:30:00Z'),
      }),
      slot({
        id: 'outside',
        startAt: new Date('2026-11-01T00:00:00Z'),
        endAt: new Date('2026-11-01T01:00:00Z'),
      }),
    ])
    expect(result.summary.hours).toBe(0.5)
    expect(result.details[0].normalValue).toBe(300000)
    expect(end.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
  it('excludes blocked capacity, includes unsold slots, and returns null occupancy without capacity', () => {
    expect(report([]).summary.occupancy).toBeNull()
    const result = report([
      slot(),
      slot({ id: 'open', isAvailable: true, bookingDetails: [] }),
      slot({ id: 'blocked', isAvailable: false, bookingDetails: [] }),
    ])
    expect(result.summary.availableHours).toBe(4)
    expect(result.summary.occupancy).toBe(50)
  })
})
