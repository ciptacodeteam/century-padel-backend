import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import {
  consumeMembershipHours,
  grantMembershipComplimentary,
} from '../src/services/membership-complimentary.service'
import {
  adjustMembershipHoursForReschedule,
  restoreMembershipHoursForBooking,
} from '../src/services/membership-hours.service'

// Opt-in only. Use a disposable PostgreSQL database with the schema and SQL
// patch applied. Fixtures are unique and never access application accounts.
const url = process.env.MEMBERSHIP_TEST_DATABASE_URL
const db = new PrismaClient({
  datasourceUrl: url || 'postgresql://unused:unused@localhost:1/unused',
})
afterAll(() => db.$disconnect())
async function fixture() {
  const key = randomUUID()
  const user = await db.user.create({
    data: { name: 'Complimentary Test', phone: `test-${key}` },
  })
  const admin = await db.staff.create({
    data: {
      name: 'Test Admin',
      email: `${key}@example.invalid`,
      password: 'not-a-real-login',
      role: 'ADMIN',
    },
  })
  const membership = await db.membership.create({
    data: { name: `Test ${key}`, price: 1000000, sessions: 2, duration: 36500 },
  })
  const balance = await db.membershipUser.create({
    data: {
      userId: user.id,
      membershipId: membership.id,
      startDate: new Date('2020-01-01'),
      endDate: new Date('2099-12-01'),
      remainingDuration: 36500,
      remainingSessions: 2,
      invoice: {
        create: {
          userId: user.id,
          number: key,
          subtotal: 1000000,
          total: 1000000,
          status: 'PAID',
          dueDate: new Date('2099-12-01'),
          paidAt: new Date(),
        },
      },
    },
  })
  const grant = (hours: number, requestId = randomUUID()) =>
    db.$transaction((tx) =>
      grantMembershipComplimentary(tx, {
        membershipUserId: balance.id,
        adminId: admin.id,
        hours,
        reason: 'Integration test',
        requestId,
      }),
    )
  const checkout = (hours: number) =>
    db.$transaction(
      async (tx) => {
        const booking = await tx.booking.create({
          data: {
            userId: user.id,
            status: 'CONFIRMED',
            courtNormalPrice: 300000,
          },
        })
        const slot = await tx.slot.create({
          data: {
            type: 'COURT',
            startAt: new Date('2099-01-01T08:00:00Z'),
            endAt: new Date(
              new Date('2099-01-01T08:00:00Z').getTime() + hours * 3600000,
            ),
            price: 300000,
          },
        })
        await tx.bookingDetail.create({
          data: {
            bookingId: booking.id,
            slotId: slot.id,
            price: 300000,
            membershipUserId: balance.id,
          },
        })
        await consumeMembershipHours(tx, balance.id, booking.id, hours)
        return tx.booking.findUniqueOrThrow({
          where: { id: booking.id },
          include: { details: { include: { slot: true } } },
        })
      },
      { timeout: 10000 },
    )
  return { user, admin, balance, grant, checkout }
}

describe.skipIf(!url)('membership complimentary PostgreSQL integration', () => {
  it('serializes identical grant requests and creates no additional revenue invoice', async () => {
    const f = await fixture()
    const requestId = randomUUID()
    const results = await Promise.all([
      f.grant(3, requestId),
      f.grant(3, requestId),
      f.grant(3, requestId),
    ])
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
    const balance = await db.membershipUser.findUniqueOrThrow({
      where: { id: f.balance.id },
    })
    expect(balance).toMatchObject({
      remainingSessions: 5,
      remainingComplimentarySessions: 3,
      totalComplimentarySessions: 3,
      endDate: f.balance.endDate,
    })
    expect(await db.invoice.count({ where: { userId: f.user.id } })).toBe(1)
    expect(
      await db.membershipComplimentaryGrant.count({
        where: { membershipUserId: f.balance.id },
      }),
    ).toBe(1)
  })
  it('prevents two simultaneous checkouts from spending the same balance', async () => {
    const f = await fixture()
    await f.grant(2)
    const results = await Promise.allSettled([f.checkout(3), f.checkout(3)])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const balance = await db.membershipUser.findUniqueOrThrow({
      where: { id: f.balance.id },
    })
    expect(balance).toMatchObject({
      remainingSessions: 1,
      remainingComplimentarySessions: 0,
    })
    expect(await db.booking.count({ where: { userId: f.user.id } })).toBe(1)
    const details = await db.bookingDetail.findMany({
      where: { membershipUserId: f.balance.id },
    })
    expect(details).toHaveLength(1)
    expect(details[0].complimentaryMembershipHours).toBe(2)
  })
  it('restores the original split exactly once across concurrent cancellation requests', async () => {
    const f = await fixture()
    await f.grant(2)
    const booking = await f.checkout(3)
    const restore = () =>
      db.$transaction((tx) => restoreMembershipHoursForBooking(tx, booking))
    const restored = await Promise.all([restore(), restore(), restore()])
    expect(restored.reduce((sum, hours) => sum + hours, 0)).toBe(3)
    const balance = await db.membershipUser.findUniqueOrThrow({
      where: { id: f.balance.id },
    })
    expect(balance).toMatchObject({
      remainingSessions: 4,
      remainingComplimentarySessions: 2,
    })
  })
  it('preserves total balance when a grant and checkout arrive together', async () => {
    const f = await fixture()
    await Promise.all([f.grant(3), f.checkout(2)])
    const balance = await db.membershipUser.findUniqueOrThrow({
      where: { id: f.balance.id },
    })
    expect(balance.remainingSessions).toBe(3)
    const detail = await db.bookingDetail.findFirstOrThrow({
      where: { membershipUserId: f.balance.id },
    })
    expect(
      balance.remainingComplimentarySessions +
        detail.complimentaryMembershipHours,
    ).toBe(3)
  })
  it('keeps complimentary provenance across duration changes and cancellation', async () => {
    const f = await fixture()
    await f.grant(3)
    const booking = await f.checkout(2)
    const detail = booking.details[0]
    const newSlot = {
      startAt: detail.slot.startAt,
      endAt: new Date(detail.slot.endAt.getTime() + 3600000),
    }
    await db.$transaction(async (tx) => {
      await adjustMembershipHoursForReschedule(
        tx,
        booking,
        detail.slot,
        newSlot,
      )
      await tx.slot.update({ where: { id: detail.slotId }, data: newSlot })
    })
    const changed = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { details: { include: { slot: true } } },
    })
    expect(changed.details[0].complimentaryMembershipHours).toBe(3)
    await db.$transaction((tx) => restoreMembershipHoursForBooking(tx, changed))
    expect(
      await db.membershipUser.findUniqueOrThrow({
        where: { id: f.balance.id },
      }),
    ).toMatchObject({ remainingSessions: 5, remainingComplimentarySessions: 3 })
  })
})
