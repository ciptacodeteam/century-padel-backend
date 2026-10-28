import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  membershipStartDate,
  rescheduleMembershipStart,
} from './membership-start-date.service'

const now = new Date('2026-10-29T10:00:00Z')
const input = {
  membershipUserId: 'membership',
  adminId: 'admin',
  startDate: '2026-11-02',
  reason: 'Permintaan pelanggan',
  now,
}
function fixture(changes = {}) {
  const membership = {
    id: 'membership',
    acquisitionType: 'PURCHASE',
    startDate: new Date('2026-10-25T04:30:00Z'),
    endDate: new Date('2026-11-24T04:30:00Z'),
    isExpired: false,
    isSuspended: false,
    remainingSessions: 10,
    totalComplimentarySessions: 0,
    remainingComplimentarySessions: 0,
    membership: { sessions: 10, duration: 90 },
    invoice: { status: 'PAID', paidAt: now, payment: { meta: null } },
    _count: { bookingDetails: 0, outgoingTransfers: 0 },
    ...changes,
  }
  const raw = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    staff: { findFirst: vi.fn().mockResolvedValue({ id: 'admin' }) },
    membershipUser: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...membership })),
      update: vi
        .fn()
        .mockImplementation(async ({ data }) =>
          Object.assign(membership, data),
        ),
    },
    membershipStartDateChange: {
      create: vi.fn().mockResolvedValue({ id: 'audit' }),
    },
  }
  return { raw, membership, tx: raw as unknown as Prisma.TransactionClient }
}
describe('membership activation scheduling', () => {
  it('moves an unused paid membership to midnight WIB and preserves the original purchased duration', async () => {
    const { tx, raw, membership } = fixture()
    await rescheduleMembershipStart(tx, input)
    expect(membership.startDate).toEqual(new Date('2026-11-01T17:00:00Z'))
    expect(membership.endDate).toEqual(new Date('2026-12-01T17:00:00Z'))
    expect(membership).toMatchObject({
      remainingSessions: 10,
      remainingDuration: 30,
    })
    expect(raw.membershipStartDateChange.create).toHaveBeenCalledWith({
      data: {
        membershipUserId: 'membership',
        adminId: 'admin',
        reason: input.reason,
        previousStartDate: new Date('2026-10-25T04:30:00Z'),
        previousEndDate: new Date('2026-11-24T04:30:00Z'),
        startDate: membership.startDate,
        endDate: membership.endDate,
      },
    })
    expect(membership.invoice.paidAt).toEqual(now)
    expect(raw.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      raw.membershipUser.findUnique.mock.invocationCallOrder[0],
    )
  })
  it('does not duplicate history when an identical request is retried', async () => {
    const { tx, raw } = fixture()
    await rescheduleMembershipStart(tx, input)
    await rescheduleMembershipStart(tx, input)
    expect(raw.membershipStartDateChange.create).toHaveBeenCalledOnce()
    expect(raw.membershipUser.update).toHaveBeenCalledOnce()
  })
  it.each([
    { acquisitionType: 'TRANSFER' },
    { invoice: { status: 'PENDING' } },
    { invoice: { status: 'CANCELLED' } },
    { isExpired: true },
    { isSuspended: true },
    { endDate: now },
    { remainingSessions: 9 },
    { _count: { bookingDetails: 1, outgoingTransfers: 0 } },
    { _count: { bookingDetails: 0, outgoingTransfers: 1 } },
    {
      invoice: {
        status: 'PAID',
        payment: { meta: { refund: { status: 'COMPLETED', amount: 1 } } },
      },
    },
    {
      totalComplimentarySessions: 2,
      remainingSessions: 12,
      remainingComplimentarySessions: 1,
    },
  ])(
    'rejects ineligible membership %j without changing dates',
    async (changes) => {
      const { tx, raw } = fixture(changes)
      await expect(rescheduleMembershipStart(tx, input)).rejects.toThrow()
      expect(raw.membershipUser.update).not.toHaveBeenCalled()
      expect(raw.membershipStartDateChange.create).not.toHaveBeenCalled()
    },
  )
  it('allows untouched complimentary hours without losing them', async () => {
    const { tx, membership } = fixture({
      totalComplimentarySessions: 2,
      remainingSessions: 12,
      remainingComplimentarySessions: 2,
    })
    await rescheduleMembershipStart(tx, input)
    expect(membership.remainingSessions).toBe(12)
  })
  it('requires an active owner admin', async () => {
    const { tx, raw } = fixture()
    raw.staff.findFirst.mockResolvedValue(null as any)
    await expect(rescheduleMembershipStart(tx, input)).rejects.toThrow(
      'Super Admin',
    )
    expect(raw.membershipUser.update).not.toHaveBeenCalled()
  })
  it('returns not found for a missing membership', async () => {
    const { tx, raw } = fixture()
    raw.membershipUser.findUnique.mockResolvedValue(null as any)
    await expect(rescheduleMembershipStart(tx, input)).rejects.toThrow(
      'tidak ditemukan',
    )
  })
  it.each([
    '2026-10-28',
    '2026-02-30',
    '2026-13-02',
    'bad',
    '2026-11-02T00:00:00Z',
  ])('rejects past or invalid date %s', (date) => {
    expect(() => membershipStartDate(date, now)).toThrow()
  })
  it('uses the Jakarta day across UTC midnight', () => {
    const boundary = new Date('2026-11-01T18:00:00Z')
    expect(membershipStartDate('2026-11-02', boundary)).toEqual(
      new Date('2026-11-01T17:00:00Z'),
    )
    expect(() => membershipStartDate('2026-11-01', boundary)).toThrow()
  })
})
