import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { availableCoachesQuerySchema } from '@/lib/validation'
import dayjs from 'dayjs'

enum SlotType {
  COURT = 'COURT',
  COACH = 'COACH',
  BALLBOY = 'BALLBOY',
}

// GET /coaches/availability?startAt=YYYY-MM-DDTHH:mm&endAt=YYYY-MM-DDTHH:mm
export const getAvailableCoachesHandler = factory.createHandlers(
  zValidator('query', availableCoachesQuerySchema, validateHook),
  async (c) => {
    try {
      const { startAt, endAt } = c.req.valid('query') as {
        startAt: string
        endAt: string
      }

      const startDateTime = dayjs(startAt).toDate()
      const endDateTime = dayjs(endAt).toDate()

      // Find all available coach slots within the time range
      const slots = await db.slot.findMany({
        where: {
          type: SlotType.COACH,
          startAt: {
            gte: startDateTime,
          },
          endAt: {
            lte: endDateTime,
          },
          isAvailable: true,
          bookingCoaches: { none: {} }, // ensure not already booked
        },
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
              role: true,
            },
          },
        },
        orderBy: { price: 'asc' },
      })

      // Format the response
      const coaches = slots.map((slot) => ({
        slotId: slot.id,
        coach: slot.staff,
        price: slot.price,
        startAt: slot.startAt,
        endAt: slot.endAt,
      }))

      return c.json(ok(coaches), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableCoachesHandler: ${error}`)
      throw error
    }
  },
)
