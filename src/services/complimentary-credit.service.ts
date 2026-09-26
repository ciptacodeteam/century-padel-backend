import { BadRequestException } from '@/exceptions'
import { Prisma } from '@prisma/client'

type TransactionClient = Prisma.TransactionClient

type TimedSlot = {
  startAt: Date
  endAt: Date
}

export function getSlotDurationMinutes(slot: TimedSlot): number {
  const minutes = Math.round(
    (slot.endAt.getTime() - slot.startAt.getTime()) / 60_000,
  )

  if (minutes <= 0) {
    throw new BadRequestException('Court slot has an invalid duration')
  }

  return minutes
}

export function getTotalSlotDurationMinutes(slots: TimedSlot[]): number {
  return slots.reduce((total, slot) => total + getSlotDurationMinutes(slot), 0)
}

export async function getComplimentaryCreditBalance(
  tx: TransactionClient,
  userId: string,
  now = new Date(),
) {
  const credits = await tx.complimentaryCredit.findMany({
    where: {
      userId,
      isActive: true,
      remainingMinutes: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
  })

  return {
    totalMinutes: credits.reduce(
      (total, credit) => total + credit.remainingMinutes,
      0,
    ),
    credits,
  }
}

export async function consumeComplimentaryCredits(
  tx: TransactionClient,
  input: {
    userId: string
    bookingId: string
    requiredMinutes: number
    staffId?: string | null
  },
) {
  if (input.requiredMinutes <= 0) {
    throw new BadRequestException('Complimentary credit requires court slots')
  }

  const { credits, totalMinutes } = await getComplimentaryCreditBalance(
    tx,
    input.userId,
  )

  if (totalMinutes < input.requiredMinutes) {
    throw new BadRequestException(
      `Insufficient complimentary credit. Required ${input.requiredMinutes} minutes, available ${totalMinutes} minutes`,
    )
  }

  let outstanding = input.requiredMinutes
  for (const credit of credits) {
    if (outstanding === 0) break

    const minutes = Math.min(credit.remainingMinutes, outstanding)
    const update = await tx.complimentaryCredit.updateMany({
      where: {
        id: credit.id,
        userId: input.userId,
        isActive: true,
        remainingMinutes: { gte: minutes },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      data: { remainingMinutes: { decrement: minutes } },
    })

    if (update.count !== 1) {
      throw new BadRequestException(
        'Complimentary credit balance changed. Please try again.',
      )
    }

    await tx.complimentaryCreditTransaction.create({
      data: {
        creditId: credit.id,
        bookingId: input.bookingId,
        type: 'REDEEM',
        minutes,
        staffId: input.staffId || undefined,
      },
    })
    outstanding -= minutes
  }

  if (outstanding !== 0) {
    throw new BadRequestException(
      'Complimentary credit could not be fully allocated',
    )
  }

  await tx.booking.update({
    where: { id: input.bookingId },
    data: { complimentaryCreditRestoredAt: null },
  })

  return input.requiredMinutes
}

export async function restoreComplimentaryCreditsForBooking(
  tx: TransactionClient,
  bookingId: string,
  staffId?: string | null,
) {
  const claim = await tx.booking.updateMany({
    where: {
      id: bookingId,
      complimentaryCreditMinutes: { gt: 0 },
      complimentaryCreditRestoredAt: null,
    },
    data: { complimentaryCreditRestoredAt: new Date() },
  })
  if (claim.count === 0) return 0

  const transactions = await tx.complimentaryCreditTransaction.findMany({
    where: {
      bookingId,
      type: { in: ['REDEEM', 'REFUND'] },
    },
    orderBy: { createdAt: 'asc' },
  })

  const redeemedByCredit = new Map<string, number>()
  const refundedByCredit = new Map<string, number>()
  for (const transaction of transactions) {
    const target =
      transaction.type === 'REDEEM' ? redeemedByCredit : refundedByCredit
    target.set(
      transaction.creditId,
      (target.get(transaction.creditId) || 0) + transaction.minutes,
    )
  }

  let restoredMinutes = 0
  for (const [creditId, redeemedMinutes] of redeemedByCredit) {
    const minutes = redeemedMinutes - (refundedByCredit.get(creditId) || 0)
    if (minutes <= 0) continue

    await tx.complimentaryCredit.update({
      where: { id: creditId },
      data: { remainingMinutes: { increment: minutes } },
    })
    await tx.complimentaryCreditTransaction.create({
      data: {
        creditId,
        bookingId,
        type: 'REFUND',
        minutes,
        staffId: staffId || undefined,
        note: 'Restored after booking cancellation',
      },
    })
    restoredMinutes += minutes
  }

  return restoredMinutes
}
