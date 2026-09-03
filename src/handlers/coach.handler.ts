import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { availableCoachesQuerySchema } from '@/lib/validation'
import dayjs from 'dayjs'
import { BookingStatus, SlotType } from '@prisma/client'
import { timeRangesOverlap } from '@/services/coach-slot.service'

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

      // Find all available coach slots that overlap with the requested time range
      // A slot overlaps if: slot.startAt < request.endAt AND slot.endAt > request.startAt
      const candidateSlots = await db.slot.findMany({
        where: {
          type: SlotType.COACH,
          AND: [
            {
              startAt: {
                lt: endDateTime,
              },
            },
            {
              endAt: {
                gt: startDateTime,
              },
            },
          ],
          isAvailable: true,
          bookingCoaches: {
            none: {
              booking: {
                status: {
                  not: BookingStatus.CANCELLED,
                },
              },
            },
          }, // ensure not already booked (excluding cancelled bookings)
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

      const staffIds = [
        ...new Set(
          candidateSlots
            .map((slot) => slot.staffId)
            .filter((staffId): staffId is string => Boolean(staffId)),
        ),
      ]
      const earliestCandidateStart = candidateSlots.reduce(
        (earliest, slot) => (slot.startAt < earliest ? slot.startAt : earliest),
        candidateSlots[0]?.startAt || startDateTime,
      )
      const latestCandidateEnd = candidateSlots.reduce(
        (latest, slot) => (slot.endAt > latest ? slot.endAt : latest),
        candidateSlots[0]?.endAt || endDateTime,
      )
      const activeCoachBookings =
        staffIds.length === 0
          ? []
          : await db.bookingCoach.findMany({
              where: {
                booking: {
                  status: { not: BookingStatus.CANCELLED },
                },
                slot: {
                  staffId: { in: staffIds },
                  startAt: { lt: latestCandidateEnd },
                  endAt: { gt: earliestCandidateStart },
                },
              },
              select: {
                slot: {
                  select: {
                    staffId: true,
                    startAt: true,
                    endAt: true,
                  },
                },
              },
            })

      // A coach can have several slot records. Hide a candidate when any other
      // active booking for the same coach overlaps its complete time range.
      const slots = candidateSlots.filter(
        (candidate) =>
          !activeCoachBookings.some(
            ({ slot: bookedSlot }) =>
              bookedSlot.staffId === candidate.staffId &&
              timeRangesOverlap(
                candidate.startAt,
                candidate.endAt,
                bookedSlot.startAt,
                bookedSlot.endAt,
              ),
          ),
      )

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
