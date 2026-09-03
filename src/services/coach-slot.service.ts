import { BadRequestException } from '@/exceptions'
import { BookingStatus, Prisma, SlotType } from '@prisma/client'

const coachSlotSelect = {
  id: true,
  staffId: true,
  startAt: true,
  endAt: true,
  price: true,
  isAvailable: true,
} satisfies Prisma.SlotSelect

export type CoachSlotForBooking = Prisma.SlotGetPayload<{
  select: typeof coachSlotSelect
}>

export const timeRangesOverlap = (
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date,
) => firstStart < secondEnd && firstEnd > secondStart

export const assertCoachSlotSelectionValid = (
  requestedSlotIds: string[],
  slots: CoachSlotForBooking[],
) => {
  const uniqueSlotIds = new Set(requestedSlotIds)
  if (
    uniqueSlotIds.size !== requestedSlotIds.length ||
    slots.length !== requestedSlotIds.length ||
    slots.some((slot) => !slot.staffId || !slot.isAvailable)
  ) {
    throw new BadRequestException(
      'One or more coach slots not found or unavailable',
    )
  }

  for (let firstIndex = 0; firstIndex < slots.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < slots.length;
      secondIndex += 1
    ) {
      const first = slots[firstIndex]
      const second = slots[secondIndex]

      if (
        first.staffId === second.staffId &&
        timeRangesOverlap(
          first.startAt,
          first.endAt,
          second.startAt,
          second.endAt,
        )
      ) {
        throw new BadRequestException(
          'The selected coach has overlapping schedule slots',
        )
      }
    }
  }
}

type CoachSlotReservationOptions = {
  reserve?: boolean
  excludeBookingCoachIds?: string[]
}

/**
 * Validates coach availability across the complete time range. When reserve is
 * enabled, a transaction-scoped advisory lock serializes bookings per coach and
 * the selected slot rows are claimed atomically before the caller creates the
 * BookingCoach records.
 */
export const validateCoachSlots = async (
  tx: Prisma.TransactionClient,
  requestedSlotIds: string[],
  options: CoachSlotReservationOptions = {},
) => {
  let slots = await tx.slot.findMany({
    where: {
      id: { in: requestedSlotIds },
      type: SlotType.COACH,
    },
    select: coachSlotSelect,
  })

  assertCoachSlotSelectionValid(requestedSlotIds, slots)

  if (options.reserve) {
    const staffIds = [...new Set(slots.map((slot) => slot.staffId!))].sort()

    for (const staffId of staffIds) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${staffId}))`
    }

    // Availability may have changed while waiting for another checkout.
    slots = await tx.slot.findMany({
      where: {
        id: { in: requestedSlotIds },
        type: SlotType.COACH,
      },
      select: coachSlotSelect,
    })
    assertCoachSlotSelectionValid(requestedSlotIds, slots)
  }

  const conflict = await tx.bookingCoach.findFirst({
    where: {
      ...(options.excludeBookingCoachIds?.length
        ? { id: { notIn: options.excludeBookingCoachIds } }
        : {}),
      booking: {
        status: { not: BookingStatus.CANCELLED },
      },
      OR: slots.map((slot) => ({
        slot: {
          staffId: slot.staffId!,
          startAt: { lt: slot.endAt },
          endAt: { gt: slot.startAt },
        },
      })),
    },
    select: { id: true },
  })

  if (conflict) {
    throw new BadRequestException(
      'The selected coach already has a booking that overlaps this schedule',
    )
  }

  if (options.reserve) {
    const claimedSlots = await tx.slot.updateMany({
      where: {
        id: { in: requestedSlotIds },
        type: SlotType.COACH,
        isAvailable: true,
      },
      data: { isAvailable: false },
    })

    if (claimedSlots.count !== requestedSlotIds.length) {
      throw new BadRequestException(
        'One or more coach slots are no longer available',
      )
    }
  }

  return slots
}
