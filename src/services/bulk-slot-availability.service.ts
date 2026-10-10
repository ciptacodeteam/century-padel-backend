import { Prisma } from '@prisma/client'
import { BadRequestException } from '@/exceptions'

export async function bulkSlotAvailability(
  tx: Prisma.TransactionClient,
  courtId: string,
  slotIds: string[],
  isAvailable: boolean,
) {
  const ids = [...new Set(slotIds)]
  const scope = { id: { in: ids }, courtId, type: 'COURT' as const }
  const slots = await tx.slot.findMany({ where: scope, select: { id: true } })
  if (slots.length !== ids.length) {
    throw new BadRequestException('Some slots do not belong to this court')
  }
  const free = {
    ...scope,
    bookingDetails: {
      none: {
        cancelledAt: null,
        booking: { status: { not: 'CANCELLED' as const } },
      },
    },
  }
  const eligible = await tx.slot.count({ where: free })
  const result = await tx.slot.updateMany({
    where: { ...free, isAvailable: !isAvailable },
    data: { isAvailable },
  })
  return {
    updated: result.count,
    skipped: ids.length - eligible,
    unchanged: eligible - result.count,
  }
}
