import { BadRequestException } from '@/exceptions'
import { PaymentStatus, Prisma, type Slot } from '@prisma/client'
import { canMembershipUseSlots } from './membership-eligibility.service'

type TransactionClient = Prisma.TransactionClient

type BookingForMembershipHours = {
  userId: string
  createdAt: Date
  courtNormalPrice: number
  details: Array<{
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
      include: { membership: true },
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
      startDate: { lte: booking.createdAt },
      endDate: { gt: booking.createdAt },
      updatedAt: { gte: booking.createdAt },
      invoice: { is: { status: PaymentStatus.PAID } },
    },
    include: { membership: true },
    orderBy: { endDate: 'asc' },
  })

  return (
    candidates.find(
      (candidate) =>
        candidate.remainingSessions < candidate.membership.sessions,
    ) ?? null
  )
}

export async function restoreMembershipHoursForBooking(
  tx: TransactionClient,
  booking: BookingForMembershipHours,
): Promise<number> {
  const explicitlyCoveredDetails = booking.details.filter(
    (detail) => detail.membershipUserId,
  )
  const coveredDetails =
    explicitlyCoveredDetails.length > 0
      ? explicitlyCoveredDetails
      : booking.courtNormalPrice === 0
        ? booking.details
        : []
  const hours = calculateCourtHours(coveredDetails.map(({ slot }) => slot))
  if (hours === 0) return 0

  const membershipUser = await findMembershipUsedByBooking(tx, booking)
  if (!membershipUser) return 0

  const restoredHours = Math.min(
    hours,
    membershipUser.membership.sessions - membershipUser.remainingSessions,
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

export async function adjustMembershipHoursForReschedule(
  tx: TransactionClient,
  booking: BookingForMembershipHours,
  oldSlot: Pick<Slot, 'startAt' | 'endAt'>,
  newSlot: Pick<Slot, 'startAt' | 'endAt'>,
): Promise<number> {
  const hourDifference =
    calculateCourtHours([newSlot]) - calculateCourtHours([oldSlot])

  const membershipUser = await findMembershipUsedByBooking(tx, booking)
  if (!membershipUser) return 0

  if (!canMembershipUseSlots(membershipUser.membership.type, [newSlot])) {
    throw new BadRequestException(
      'Membership Happy Hour cannot be rescheduled to a Peak Hour slot',
    )
  }
  if (hourDifference === 0) return 0

  if (hourDifference > 0) {
    if (membershipUser.remainingSessions < hourDifference) {
      throw new BadRequestException(
        `Membership does not have enough remaining hours for this reschedule`,
      )
    }

    const remainingHours = membershipUser.remainingSessions - hourDifference
    await tx.membershipUser.update({
      where: { id: membershipUser.id },
      data: {
        remainingSessions: remainingHours,
        isExpired: remainingHours === 0,
      },
    })
  } else {
    const hoursToRestore = Math.min(
      Math.abs(hourDifference),
      membershipUser.membership.sessions - membershipUser.remainingSessions,
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
