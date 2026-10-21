import { BadRequestException } from '@/exceptions'
import {
  BookingStatus,
  MembershipAcquisitionType,
  Prisma,
  type Slot,
} from '@prisma/client'
import { canMembershipUseSlots } from './membership-eligibility.service'
import { fundedMembershipWhere } from './membership-entitlement.service'

type TransactionClient = Prisma.TransactionClient

type BookingForMembershipHours = {
  userId: string
  createdAt: Date
  courtNormalPrice: number
  details: Array<{
    id?: string
    cancelledAt?: Date | null
    complimentaryMembershipHours?: number
    membershipHoursRestored?: boolean
    membershipUserId?: string | null
    slot: Pick<Slot, 'startAt' | 'endAt'>
  }>
}

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000

export function calculateCourtHours(
  slots: Array<Pick<Slot, 'startAt' | 'endAt'>>,
): number {
  return slots.reduce((total, slot) => {
    const duration =
      (slot.endAt.getTime() - slot.startAt.getTime()) / MILLISECONDS_PER_HOUR

    // Membership packages are stored as whole hours. A partial hour therefore
    // consumes one full package hour, consistently with court billing units.
    return total + Math.max(0, Math.ceil(duration))
  }, 0)
}

async function findMembershipUsedByBooking(
  tx: TransactionClient,
  booking: BookingForMembershipHours,
) {
  const explicitMembershipUserId = booking.details.find(
    (detail) => detail.membershipUserId,
  )?.membershipUserId
  if (explicitMembershipUserId) {
    return tx.membershipUser.findUnique({
      where: { id: explicitMembershipUserId },
      include: {
        membership: true,
        incomingTransfer: {
          select: { transferredHours: true, cancelledAt: true },
        },
      },
    })
  }

  if (booking.courtNormalPrice !== 0 || booking.details.length === 0) {
    return null
  }

  // Legacy bookings do not store membershipUserId. Admin checkout always uses
  // the membership that expires first, so repeat that deterministic selection.
  const candidates = await tx.membershipUser.findMany({
    where: {
      userId: booking.userId,
      acquisitionType: MembershipAcquisitionType.PURCHASE,
      startDate: { lte: booking.createdAt },
      endDate: { gt: booking.createdAt },
      updatedAt: { gte: booking.createdAt },
      ...fundedMembershipWhere(),
    },
    include: {
      membership: true,
      incomingTransfer: {
        select: { transferredHours: true, cancelledAt: true },
      },
    },
    orderBy: { endDate: 'asc' },
  })

  return (
    candidates.find(
      (candidate) =>
        candidate.remainingSessions < candidate.membership.sessions,
    ) ?? null
  )
}

function maximumRestorableHours(membershipUser: {
  totalComplimentarySessions?: number
  membership: { sessions: number }
  incomingTransfer: {
    transferredHours: number
    cancelledAt?: Date | null
  } | null
}): number {
  if (membershipUser.incomingTransfer?.cancelledAt) return 0
  return (
    (membershipUser.incomingTransfer?.transferredHours ??
      membershipUser.membership.sessions) +
    (membershipUser.totalComplimentarySessions ?? 0)
  )
}

export async function restoreMembershipHoursForBooking(
  tx: TransactionClient,
  booking: BookingForMembershipHours,
): Promise<number> {
  // Persisted detail claims prevent duplicate restores across scheduler,
  // webhook, whole-booking cancellation and individual court cancellation.
  const tracked = booking.details.filter(
    (detail) => detail.id && detail.membershipUserId && !detail.cancelledAt,
  )
  if (booking.details.some((detail) => detail.id && detail.membershipUserId)) {
    let restored = 0
    for (const original of [...tracked].sort(
      (a, b) =>
        a.membershipUserId!.localeCompare(b.membershipUserId!) ||
        a.id!.localeCompare(b.id!),
    )) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM booking_details WHERE id = ${original.id!} FOR UPDATE`,
      )
      const detail = await tx.bookingDetail.findUniqueOrThrow({
        where: { id: original.id! },
        include: { slot: true },
      })
      if (detail.membershipHoursRestored || !detail.membershipUserId) continue
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM membership_users WHERE id = ${detail.membershipUserId} FOR NO KEY UPDATE`,
      )
      const membership = await tx.membershipUser.findUniqueOrThrow({
        where: { id: detail.membershipUserId },
        include: { incomingTransfer: true },
      })
      await tx.bookingDetail.update({
        where: { id: detail.id },
        data: { membershipHoursRestored: true },
      })
      // Never resurrect a revoked transfer or permanently terminated membership.
      if (
        membership.incomingTransfer?.cancelledAt ||
        (membership.isSuspended && membership.endDate <= new Date())
      )
        continue
      const hours = calculateCourtHours([detail.slot])
      await tx.membershipUser.update({
        where: { id: membership.id },
        data: {
          remainingSessions: { increment: hours },
          remainingComplimentarySessions: {
            increment: detail.complimentaryMembershipHours,
          },
          isExpired: membership.endDate <= new Date(),
        },
      })
      restored += hours
    }
    return restored
  }
  const explicitlyCoveredDetails = booking.details.filter(
    (detail) => detail.membershipUserId,
  )

  if (explicitlyCoveredDetails.length > 0) {
    const detailsByMembershipId = new Map<
      string,
      Array<(typeof explicitlyCoveredDetails)[number]>
    >()
    for (const detail of explicitlyCoveredDetails) {
      const membershipUserId = detail.membershipUserId!
      const details = detailsByMembershipId.get(membershipUserId) ?? []
      details.push(detail)
      detailsByMembershipId.set(membershipUserId, details)
    }

    let totalRestoredHours = 0
    for (const [membershipUserId, details] of detailsByMembershipId) {
      const membershipUser = await tx.membershipUser.findUnique({
        where: { id: membershipUserId },
        include: {
          membership: true,
          incomingTransfer: {
            select: { transferredHours: true, cancelledAt: true },
          },
        },
      })
      if (!membershipUser) continue

      const hours = calculateCourtHours(details.map(({ slot }) => slot))
      const restoredHours = Math.min(
        hours,
        maximumRestorableHours(membershipUser) -
          membershipUser.remainingSessions,
      )
      if (restoredHours <= 0) continue

      await tx.membershipUser.update({
        where: { id: membershipUser.id },
        data: {
          remainingSessions: { increment: restoredHours },
          isExpired: membershipUser.endDate <= new Date(),
        },
      })
      totalRestoredHours += restoredHours
    }

    return totalRestoredHours
  }

  const coveredDetails = booking.courtNormalPrice === 0 ? booking.details : []
  const hours = calculateCourtHours(coveredDetails.map(({ slot }) => slot))
  if (hours === 0) return 0

  const membershipUser = await findMembershipUsedByBooking(tx, booking)
  if (!membershipUser) return 0

  const restoredHours = Math.min(
    hours,
    maximumRestorableHours(membershipUser) - membershipUser.remainingSessions,
  )
  if (restoredHours <= 0) return 0

  await tx.membershipUser.update({
    where: { id: membershipUser.id },
    data: {
      remainingSessions: { increment: restoredHours },
      isExpired: membershipUser.endDate <= new Date(),
    },
  })

  return restoredHours
}

export async function restoreMembershipHoursForBookingDetail(
  tx: TransactionClient,
  booking: Omit<BookingForMembershipHours, 'details'>,
  detail: BookingForMembershipHours['details'][number],
): Promise<number> {
  return restoreMembershipHoursForBooking(tx, {
    ...booking,
    details: [detail],
  })
}

export async function restoreMembershipHoursForBookingId(
  tx: TransactionClient,
  bookingId: string,
): Promise<number> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      userId: true,
      status: true,
      createdAt: true,
      courtNormalPrice: true,
      details: {
        select: {
          id: true,
          cancelledAt: true,
          membershipUserId: true,
          slot: {
            select: {
              startAt: true,
              endAt: true,
            },
          },
        },
      },
    },
  })

  // Every expiry/cancellation path restores before changing the booking to
  // CANCELLED. This guard makes duplicate scheduler/webhook events idempotent.
  if (!booking || booking.status === BookingStatus.CANCELLED) return 0

  return restoreMembershipHoursForBooking(tx, booking)
}

export async function adjustMembershipHoursForReschedule(
  tx: TransactionClient,
  booking: BookingForMembershipHours,
  oldSlot: Pick<Slot, 'startAt' | 'endAt'>,
  newSlot: Pick<Slot, 'startAt' | 'endAt'>,
): Promise<number> {
  const hourDifference =
    calculateCourtHours([newSlot]) - calculateCourtHours([oldSlot])

  const detailId = booking.details[0]?.id
  if (detailId) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM booking_details WHERE id = ${detailId} FOR UPDATE`,
    )
  }
  const membershipUser = await findMembershipUsedByBooking(tx, booking)
  if (!membershipUser) return 0

  if (!canMembershipUseSlots(membershipUser.membership.type, [newSlot])) {
    throw new BadRequestException(
      'Membership Happy Hour cannot be rescheduled to a Peak Hour slot',
    )
  }
  if (detailId && booking.details[0]?.membershipUserId) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM membership_users WHERE id = ${membershipUser.id} FOR NO KEY UPDATE`,
    )
    const current = await tx.membershipUser.findFirst({
      where: { id: membershipUser.id, ...fundedMembershipWhere() },
    })
    if (!current)
      throw new BadRequestException(
        'Membership tidak memenuhi syarat perubahan jadwal',
      )
    const detail = await tx.bookingDetail.findUniqueOrThrow({
      where: { id: detailId },
    })
    const now = new Date()
    // Rescheduling cannot bypass a suspended or elapsed entitlement, even
    // when the old and new slots have identical durations.
    if (
      detail.membershipHoursRestored ||
      current.isSuspended ||
      current.endDate <= now ||
      current.startDate > now
    ) {
      throw new BadRequestException(
        'Membership tidak aktif untuk perubahan jadwal',
      )
    }
    if (hourDifference === 0) return 0
    if (hourDifference > 0) {
      const complimentary = Math.min(
        hourDifference,
        current.remainingComplimentarySessions,
      )
      const claim = await tx.membershipUser.updateMany({
        where: {
          id: current.id,
          remainingSessions: { gte: hourDifference },
          ...fundedMembershipWhere(),
        },
        data: {
          remainingSessions: { decrement: hourDifference },
          remainingComplimentarySessions: { decrement: complimentary },
          isExpired: current.remainingSessions === hourDifference,
        },
      })
      if (claim.count !== 1)
        throw new BadRequestException('Saldo membership tidak mencukupi')
      await tx.bookingDetail.update({
        where: { id: detailId },
        data: { complimentaryMembershipHours: { increment: complimentary } },
      })
    } else {
      const complimentary = Math.min(
        -hourDifference,
        detail.complimentaryMembershipHours,
      )
      await tx.membershipUser.update({
        where: { id: current.id },
        data: {
          remainingSessions: { increment: -hourDifference },
          remainingComplimentarySessions: { increment: complimentary },
          isExpired: false,
        },
      })
      await tx.bookingDetail.update({
        where: { id: detailId },
        data: { complimentaryMembershipHours: { decrement: complimentary } },
      })
    }
    return hourDifference
  }
  if (hourDifference === 0) return 0

  if (hourDifference > 0) {
    const deduction = await tx.membershipUser.updateMany({
      where: {
        id: membershipUser.id,
        remainingSessions: { gte: hourDifference },
        isExpired: false,
        isSuspended: false,
        ...fundedMembershipWhere(),
      },
      data: { remainingSessions: { decrement: hourDifference } },
    })
    if (deduction.count !== 1) {
      throw new BadRequestException(
        'Membership balance changed during reschedule. Please try again.',
      )
    }

    const updatedMembership = await tx.membershipUser.findUniqueOrThrow({
      where: { id: membershipUser.id },
      select: { remainingSessions: true },
    })
    if (updatedMembership.remainingSessions === 0) {
      await tx.membershipUser.update({
        where: { id: membershipUser.id },
        data: { isExpired: true },
      })
    }
  } else {
    const hoursToRestore = Math.min(
      Math.abs(hourDifference),
      maximumRestorableHours(membershipUser) - membershipUser.remainingSessions,
    )
    await tx.membershipUser.update({
      where: { id: membershipUser.id },
      data: {
        remainingSessions: { increment: hoursToRestore },
        isExpired: membershipUser.endDate <= new Date(),
      },
    })
  }

  return hourDifference
}
