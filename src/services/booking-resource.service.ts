import type { Prisma } from '@prisma/client'

export async function releaseBookingSlots(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<number> {
  const [courtDetails, coachDetails, ballboyDetails] = await Promise.all([
    tx.bookingDetail.findMany({
      where: { bookingId },
      select: { slotId: true },
    }),
    tx.bookingCoach.findMany({
      where: { bookingId },
      select: { slotId: true },
    }),
    tx.bookingBallboy.findMany({
      where: { bookingId },
      select: { slotId: true },
    }),
  ])
  const slotIds = [
    ...courtDetails.map(({ slotId }) => slotId),
    ...coachDetails.map(({ slotId }) => slotId),
    ...ballboyDetails.map(({ slotId }) => slotId),
  ]

  if (slotIds.length > 0) {
    await tx.slot.updateMany({
      where: { id: { in: slotIds } },
      data: { isAvailable: true },
    })
  }

  return slotIds.length
}
