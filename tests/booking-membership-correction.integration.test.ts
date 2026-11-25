import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import {
  correctBookingToPaidMembership,
  getBookingMembershipCorrectionOptions,
} from '../src/services/booking-membership-correction.service'
import { restoreMembershipHoursForBooking } from '../src/services/membership-hours.service'
import { consumeMembershipHours } from '../src/services/membership-complimentary.service'
import {
  aggregateCourtPerformance,
  reportBounds,
} from '../src/services/court-performance.service'
import {
  buildMembershipActivity,
  membershipActivityInclude,
} from '../src/services/membership-activity.service'
import { invoiceRevenue } from '../src/services/revenue.service'

const url = process.env.MEMBERSHIP_TEST_DATABASE_URL
const db = new PrismaClient({
  datasourceUrl: url || 'postgresql://unused:unused@localhost:1/unused',
})
afterAll(() => db.$disconnect())

async function fixture(credit = false) {
  const key = randomUUID()
  const user = await db.user.create({
    data: { name: 'Correction test', phone: key },
  })
  const admin = await db.staff.create({
    data: {
      name: 'Test admin',
      email: `${key}@example.invalid`,
      password: 'unused',
      role: 'ADMIN',
    },
  })
  const pkg = await db.membership.create({
    data: {
      name: key,
      type: 'HAPPY_HOUR',
      price: 17000000,
      sessions: 100,
      duration: 36500,
    },
  })
  async function membership(source = false) {
    return db.membershipUser.create({
      data: {
        userId: user.id,
        membershipId: pkg.id,
        startDate: new Date('2020-01-01'),
        endDate: new Date('2099-01-01'),
        remainingDuration: 36500,
        remainingSessions: source ? 0 : 100,
        totalComplimentarySessions: source ? 20 : 0,
        isExpired: source,
        invoice: {
          create: {
            userId: user.id,
            number: randomUUID(),
            subtotal: 17000000,
            total: 17000000,
            status: 'PAID',
            dueDate: new Date('2099-01-01'),
            paidAt: new Date(),
          },
        },
      },
    })
  }
  const source = await membership(true)
  const target = await membership()
  const creditBalance = credit
    ? await db.complimentaryCredit.create({
        data: {
          userId: user.id,
          purpose: 'OTHER',
          grantedMinutes: 1200,
          remainingMinutes: 0,
          grantedById: admin.id,
        },
      })
    : null
  async function booking(date: string) {
    const result = await db.booking.create({
      data: {
        userId: user.id,
        cashierId: admin.id,
        status: 'CONFIRMED',
        totalPrice: 0,
        complimentaryCreditMinutes: credit ? 600 : 0,
        complimentaryCreditValue: credit ? 2700000 : 0,
        invoice: {
          create: {
            userId: user.id,
            number: randomUUID(),
            subtotal: 0,
            total: 0,
            status: 'PAID',
            dueDate: new Date('2099-01-01'),
          },
        },
      },
    })
    for (let i = 0; i < 10; i++) {
      const slot = await db.slot.create({
        data: {
          type: 'COURT',
          startAt: new Date(`${date}T09:00:00Z`),
          endAt: new Date(`${date}T10:00:00Z`),
          price: 270000,
        },
      })
      await db.bookingDetail.create({
        data: {
          bookingId: result.id,
          price: 270000,
          membershipUserId: credit ? null : source.id,
          complimentaryMembershipHours: credit ? 0 : 1,
          complimentaryCreditMinutes: credit ? 60 : 0,
          slotId: slot.id,
        },
      })
    }
    if (creditBalance)
      await db.complimentaryCreditTransaction.create({
        data: {
          creditId: creditBalance.id,
          bookingId: result.id,
          type: 'REDEEM',
          minutes: 600,
        },
      })
    return result
  }
  const first = await booking('2026-11-17')
  const second = await booking('2026-11-24')
  const correct = (bookingId = first.id, membershipUserId = target.id) =>
    db.$transaction(
      (tx) =>
        correctBookingToPaidMembership(tx, {
          bookingId,
          membershipUserId,
          adminId: admin.id,
          reason: 'Koreksi salah input gratis',
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    )
  return {
    user,
    admin,
    source,
    target,
    first,
    second,
    correct,
    creditBalance,
    pkg,
  }
}

const getBalance = (id: string) =>
  db.membershipUser.findUniqueOrThrow({ where: { id } })
const getBooking = (id: string) =>
  db.booking.findUniqueOrThrow({
    where: { id },
    include: {
      details: {
        include: {
          slot: true,
          membershipUser: { include: { membership: true } },
        },
      },
      invoice: true,
    },
  })

describe.skipIf(!url)('booking membership correction PostgreSQL', () => {
  it('moves 20 court hours, retires free usage, reclassifies reports and preserves cash revenue', async () => {
    const f = await fixture()
    await f.correct()
    await f.correct(f.second.id)
    expect(await getBalance(f.target.id)).toMatchObject({
      remainingSessions: 80,
      remainingComplimentarySessions: 0,
    })
    expect(await getBalance(f.source.id)).toMatchObject({
      remainingSessions: 0,
      remainingComplimentarySessions: 0,
    })
    const booking = await getBooking(f.first.id)
    expect(
      booking.details.every(
        (d) =>
          d.membershipUserId === f.target.id &&
          d.complimentaryMembershipHours === 0,
      ),
    ).toBe(true)
    expect(booking.invoice?.total).toBe(0)
    expect(invoiceRevenue({ total: 17000000, processingFee: 0 }).net).toBe(
      17000000,
    )
    expect(
      await db.bookingMembershipCorrection.count({
        where: { bookingId: { in: [f.first.id, f.second.id] } },
      }),
    ).toBe(2)
    const { start, end } = reportBounds('2026-11-17', '2026-11-17')
    const report = aggregateCourtPerformance(
      booking.details.map((d) => ({
        ...d.slot,
        court: null,
        bookingDetails: [{ ...d, booking: { ...booking, user: f.user } }],
      })),
      [f.pkg],
      start,
      end,
      5,
    )
    expect(
      report.rows.find((r) => r.id === `membership:${f.pkg.id}`)?.hours,
    ).toBe(10)
    expect(report.rows.find((r) => r.id === 'complimentary')).toBeUndefined()
    const history = await db.membershipUser.findMany({
      where: { userId: f.user.id },
      include: membershipActivityInclude,
    })
    const corrections = await db.bookingMembershipCorrection.findMany({
      where: { booking: { userId: f.user.id } },
      include: { booking: { include: { invoice: true } } },
    })
    const activity = buildMembershipActivity(history, new Date(), corrections)
    expect(
      activity.memberships.find((m) => m.id === f.source.id),
    ).toMatchObject({ retiredComplimentaryHours: 20, untrackedHours: 100 })
    expect(
      activity.events
        .filter((e) => e.title === 'Koreksi kuota gratis ke paket berbayar')
        .reduce((sum, e) => sum + e.hours, 0),
    ).toBe(-20)
  })

  it('prevents duplicate concurrent corrections and double deductions', async () => {
    const f = await fixture()
    const results = await Promise.allSettled([
      f.correct(),
      f.correct(),
      f.correct(),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await getBalance(f.target.id)).remainingSessions).toBe(90)
    expect(
      await db.bookingMembershipCorrection.count({
        where: { bookingId: f.first.id },
      }),
    ).toBe(1)
    await expect(f.correct()).rejects.toThrow()
  })

  it('restores only paid target hours exactly once on cancellation', async () => {
    const f = await fixture()
    await f.correct()
    const original = await getBooking(f.first.id)
    const cancel = () =>
      db.$transaction((tx) => restoreMembershipHoursForBooking(tx, original), {
        timeout: 10000,
      })
    const restored = await Promise.all([cancel(), cancel()])
    expect(restored.reduce((a, b) => a + b, 0)).toBe(10)
    expect(await getBalance(f.target.id)).toMatchObject({
      remainingSessions: 100,
      remainingComplimentarySessions: 0,
    })
    expect((await getBalance(f.source.id)).remainingSessions).toBe(0)
  })

  it('closes old credit redemption without returning spendable free minutes', async () => {
    const f = await fixture(true)
    await f.correct()
    expect(
      await db.complimentaryCredit.findUniqueOrThrow({
        where: { id: f.creditBalance!.id },
      }),
    ).toMatchObject({ remainingMinutes: 0 })
    expect(await getBooking(f.first.id)).toMatchObject({
      complimentaryCreditMinutes: 0,
      complimentaryCreditValue: 0,
    })
    expect(
      await db.complimentaryCreditTransaction.count({
        where: { bookingId: f.first.id, type: 'REVOKE' },
      }),
    ).toBe(1)
    expect((await getBalance(f.target.id)).remainingSessions).toBe(90)
  })

  it.each([
    'insufficient',
    'complimentary-only',
    'wrong-owner',
    'unpaid',
    'refunded',
    'suspended',
    'banned',
    'outside-dates',
    'peak-slot',
    'cancelled',
    'mixed-detail',
    'inactive-admin',
  ])(
    'rejects %s with all balances and booking details untouched',
    async (problem) => {
      const f = await fixture()
      if (problem === 'insufficient')
        await db.membershipUser.update({
          where: { id: f.target.id },
          data: { remainingSessions: 9 },
        })
      if (problem === 'complimentary-only')
        await db.membershipUser.update({
          where: { id: f.target.id },
          data: {
            remainingComplimentarySessions: 100,
            totalComplimentarySessions: 100,
          },
        })
      if (problem === 'wrong-owner') {
        const other = await db.user.create({
          data: { name: 'Other', phone: randomUUID() },
        })
        await db.membershipUser.update({
          where: { id: f.target.id },
          data: { userId: other.id },
        })
      }
      if (problem === 'unpaid' || problem === 'refunded')
        await db.invoice.update({
          where: { membershipUserId: f.target.id },
          data: { status: problem === 'unpaid' ? 'PENDING' : 'REFUNDED' },
        })
      if (problem === 'suspended')
        await db.membershipUser.update({
          where: { id: f.target.id },
          data: { isSuspended: true },
        })
      if (problem === 'banned')
        await db.user.update({
          where: { id: f.user.id },
          data: { banned: true },
        })
      if (problem === 'outside-dates')
        await db.membershipUser.update({
          where: { id: f.target.id },
          data: { startDate: new Date('2026-11-18T00:00:00+07:00') },
        })
      if (problem === 'peak-slot') {
        const booking = await getBooking(f.first.id)
        await db.slot.update({
          where: { id: booking.details[0].slotId },
          data: {
            startAt: new Date('2026-11-17T18:00:00Z'),
            endAt: new Date('2026-11-17T19:00:00Z'),
          },
        })
      }
      if (problem === 'cancelled')
        await db.booking.update({
          where: { id: f.first.id },
          data: { status: 'CANCELLED' },
        })
      if (problem === 'mixed-detail') {
        const booking = await getBooking(f.first.id)
        await db.slot.update({
          where: { id: booking.details[0].slotId },
          data: { endAt: new Date('2026-11-17T11:00:00Z') },
        })
      }
      if (problem === 'inactive-admin')
        await db.staff.update({
          where: { id: f.admin.id },
          data: { isActive: false },
        })
      const before = await getBalance(f.target.id)
      await expect(f.correct()).rejects.toThrow()
      expect(await getBalance(f.target.id)).toEqual(before)
      expect(
        (await getBooking(f.first.id)).details.every(
          (d) => d.membershipUserId === f.source.id,
        ),
      ).toBe(true)
      expect(
        await db.bookingMembershipCorrection.count({
          where: { bookingId: f.first.id },
        }),
      ).toBe(0)
    },
  )

  it('serializes competing checkout against correction without spending free quota or overdrawing', async () => {
    const f = await fixture()
    await db.membershipUser.update({
      where: { id: f.target.id },
      data: { remainingSessions: 10 },
    })
    const checkoutBooking = await db.booking.create({
      data: { userId: f.user.id },
    })
    const slot = await db.slot.create({
      data: {
        type: 'COURT' as const,
        startAt: new Date('2026-11-24T09:00:00Z'),
        endAt: new Date('2026-11-24T19:00:00Z'),
        price: 1,
      },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: checkoutBooking.id,
        slotId: slot.id,
        price: 1,
        membershipUserId: f.target.id,
      },
    })
    const checkout = db.$transaction(
      (tx) => consumeMembershipHours(tx, f.target.id, checkoutBooking.id, 10),
      { timeout: 10000 },
    )
    const results = await Promise.allSettled([f.correct(), checkout])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await getBalance(f.target.id)).remainingSessions).toBe(0)
  })

  it('lists eligible packages and handles a source that is also the paid target', async () => {
    const f = await fixture()
    const options = await db.$transaction((tx) =>
      getBookingMembershipCorrectionOptions(tx, f.first.id),
    )
    expect(options.hours).toBe(10)
    expect(options.memberships.map((m) => m.id)).toContain(f.target.id)
    await db.membershipUser.update({
      where: { id: f.source.id },
      data: {
        remainingSessions: 30,
        remainingComplimentarySessions: 5,
        isExpired: false,
      },
    })
    await f.correct(f.first.id, f.source.id)
    expect(await getBalance(f.source.id)).toMatchObject({
      remainingSessions: 20,
      remainingComplimentarySessions: 5,
    })
  })
  it('rolls back a deduction, source changes and audit when any later transaction step fails', async () => {
    const f = await fixture(true)
    await expect(
      db.$transaction(
        async (tx) => {
          await correctBookingToPaidMembership(tx, {
            bookingId: f.first.id,
            membershipUserId: f.target.id,
            adminId: f.admin.id,
            reason: 'Rollback simulation',
          })
          throw new Error('Failure after correction')
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      ),
    ).rejects.toThrow('Failure after correction')
    expect((await getBalance(f.target.id)).remainingSessions).toBe(100)
    expect((await getBooking(f.first.id)).complimentaryCreditMinutes).toBe(600)
    expect(
      await db.bookingMembershipCorrection.count({
        where: { bookingId: f.first.id },
      }),
    ).toBe(0)
    expect(
      await db.complimentaryCreditTransaction.count({
        where: { bookingId: f.first.id, type: 'REVOKE' },
      }),
    ).toBe(0)
  })

  it.each([false, true])(
    'cancellation after a concurrent correction reads the new source (credit=%s)',
    async (credit) => {
      const f = await fixture(credit)
      let release: () => void = () => {}
      let locked: () => void = () => {}
      const ready = new Promise<void>((resolve) => {
        locked = resolve
      })
      const hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const correcting = db.$transaction(
        async (tx) => {
          await correctBookingToPaidMembership(tx, {
            bookingId: f.first.id,
            membershipUserId: f.target.id,
            adminId: f.admin.id,
            reason: 'Concurrent cancellation test',
          })
          locked()
          await hold
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      )
      await ready
      const cancelling = db.$transaction(
        async (tx) => {
          // Same lock-before-read contract as the admin cancellation endpoint.
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM bookings WHERE id = ${f.first.id} FOR UPDATE`,
          )
          const booking = await tx.booking.findUniqueOrThrow({
            where: { id: f.first.id },
            include: { details: { include: { slot: true } } },
          })
          const hours = await restoreMembershipHoursForBooking(tx, booking)
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'CANCELLED' },
          })
          return hours
        },
        { timeout: 10000 },
      )
      release()
      await correcting
      expect(await cancelling).toBe(10)
      expect(await getBalance(f.target.id)).toMatchObject({
        remainingSessions: 100,
        remainingComplimentarySessions: 0,
      })
      expect((await getBalance(f.source.id)).remainingSessions).toBe(0)
    },
  )
})
