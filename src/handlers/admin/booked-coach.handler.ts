import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'

// Schema for cancel booking request
const cancelBookingSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required').optional(),
})

type CancelBookingSchema = z.infer<typeof cancelBookingSchema>

// GET /admin/booked-coaches
// Get all booked coaches
export const getAllBookedCoachesHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      const bookedCoaches = await db.bookingCoach.findMany({
        ...queryOptions,
        include: {
          slot: {
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
          },
          bookingCoachType: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
          booking: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  image: true,
                },
              },
              invoice: {
                select: {
                  id: true,
                  number: true,
                  status: true,
                  total: true,
                },
              },
            },
          },
        },
      })

      const formattedCoaches = bookedCoaches.map((coach) => ({
        id: coach.id,
        coachType: coach.bookingCoachType,
        staff: coach.slot.staff,
        slot: {
          id: coach.slot.id,
          startAt: coach.slot.startAt,
          endAt: coach.slot.endAt,
          date: dayjs(coach.slot.startAt).format('YYYY-MM-DD'),
          startTime: dayjs(coach.slot.startAt).format('HH:mm'),
          endTime: dayjs(coach.slot.endAt).format('HH:mm'),
          dayName: dayjs(coach.slot.startAt).format('dddd'),
          duration: dayjs(coach.slot.endAt).diff(
            dayjs(coach.slot.startAt),
            'hour',
            true,
          ),
          price: coach.slot.price,
          isAvailable: coach.slot.isAvailable,
        },
        booking: {
          id: coach.booking.id,
          status: coach.booking.status,
          totalPrice: coach.booking.totalPrice,
          customer: coach.booking.user,
          invoice: coach.booking.invoice,
          createdAt: coach.booking.createdAt,
        },
        price: coach.price,
        createdAt: coach.createdAt,
        updatedAt: coach.updatedAt,
      }))

      return c.json(ok(formattedCoaches), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllBookedCoachesHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/booked-coaches/:id
// Get detailed information about a specific booked coach
export const getBookedCoachDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const coach = await db.bookingCoach.findUnique({
        where: { id },
        include: {
          slot: {
            include: {
              staff: true,
            },
          },
          bookingCoachType: true,
          booking: {
            include: {
              user: true,
              invoice: {
                include: {
                  payment: {
                    include: {
                      method: true,
                    },
                  },
                },
              },
              details: {
                include: {
                  court: true,
                  slot: true,
                },
              },
            },
          },
        },
      })

      if (!coach) {
        return c.json(ok(null, 'Booked coach not found'), status.NOT_FOUND)
      }

      const detailedCoach = {
        id: coach.id,
        coachType: coach.bookingCoachType,
        staff: coach.slot.staff,
        slot: {
          ...coach.slot,
          date: dayjs(coach.slot.startAt).format('YYYY-MM-DD'),
          startTime: dayjs(coach.slot.startAt).format('HH:mm'),
          endTime: dayjs(coach.slot.endAt).format('HH:mm'),
          dayName: dayjs(coach.slot.startAt).format('dddd'),
          duration: dayjs(coach.slot.endAt).diff(
            dayjs(coach.slot.startAt),
            'hour',
            true,
          ),
        },
        booking: {
          ...coach.booking,
          courtSlots: coach.booking.details.map((d) => ({
            court: d.court,
            slot: {
              ...d.slot,
              date: dayjs(d.slot.startAt).format('YYYY-MM-DD'),
              startTime: dayjs(d.slot.startAt).format('HH:mm'),
              endTime: dayjs(d.slot.endAt).format('HH:mm'),
            },
          })),
        },
        price: coach.price,
        createdAt: coach.createdAt,
        updatedAt: coach.updatedAt,
      }

      return c.json(ok(detailedCoach), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getBookedCoachDetailHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/booked-coaches/:id/cancel
// Cancel a specific coach booking
export const cancelCoachBookingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', cancelBookingSchema, validateHook),
  async (c) => {
    try {
      const { id: coachBookingId } = c.req.valid('param') as IdSchema
      const { reason } = c.req.valid('json') as CancelBookingSchema

      const result = await db.$transaction(async (tx) => {
        // 1. Fetch the coach booking
        const coachBooking = await tx.bookingCoach.findUnique({
          where: { id: coachBookingId },
          include: {
            slot: {
              include: {
                staff: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            booking: {
              include: {
                invoice: true,
              },
            },
            bookingCoachType: true,
          },
        })

        if (!coachBooking) {
          throw new NotFoundException('Coach booking not found')
        }

        // 2. Check if the main booking is already cancelled
        if (coachBooking.booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException(
            'Cannot cancel coach booking - main booking is already cancelled',
          )
        }

        // 3. Release the coach slot
        await tx.slot.update({
          where: { id: coachBooking.slotId },
          data: {
            isAvailable: true,
          },
        })

        // 4. Delete the coach booking
        await tx.bookingCoach.delete({
          where: { id: coachBookingId },
        })

        // 5. Update the main booking total price (subtract coach price)
        const updatedBooking = await tx.booking.update({
          where: { id: coachBooking.bookingId },
          data: {
            totalPrice: {
              decrement: coachBooking.price,
            },
          },
        })

        // 6. Update invoice if exists
        if (coachBooking.booking.invoice) {
          await tx.invoice.update({
            where: { id: coachBooking.booking.invoice.id },
            data: {
              subtotal: {
                decrement: coachBooking.price,
              },
              total: {
                decrement: coachBooking.price,
              },
            },
          })
        }

        return {
          coachBooking,
          updatedBooking,
          releasedSlot: coachBooking.slot,
        }
      })

      return c.json(
        ok(
          {
            cancelledCoach: {
              id: result.coachBooking.id,
              coachType: result.coachBooking.bookingCoachType.name,
              staff: result.releasedSlot.staff,
              price: result.coachBooking.price,
              slot: {
                startAt: result.releasedSlot.startAt,
                endAt: result.releasedSlot.endAt,
                isAvailable: true,
              },
            },
            updatedBooking: {
              id: result.updatedBooking.id,
              totalPrice: result.updatedBooking.totalPrice,
            },
            reason: reason || 'Cancelled by admin',
          },
          'Coach booking cancelled successfully. Slot has been released.',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in cancelCoachBookingHandler: ${error}`)
      throw error
    }
  },
)
