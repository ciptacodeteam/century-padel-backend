import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  availableCourtSlotsQuerySchema,
  AvailableCourtSlotsQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { getFileUrl } from '@/services/upload.service'
import { SlotType } from '@prisma/client'
import dayjs from 'dayjs'
import { DATETIME_FORMAT } from '@/constants'
import z from 'zod'

export const getAllCourtHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema.extend({
    startAt: z.string().refine((val) => dayjs(val).isValid(), {
      message: 'Invalid datetime format for startAt',
    }).optional(),
    endAt: z.string().refine((val) => dayjs(val).isValid(), {
      message: 'Invalid datetime format for endAt',
    }).optional(),
  }).refine(
    (vals) =>
      (!vals.startAt && !vals.endAt) ||
      (vals.startAt !== undefined && vals.endAt !== undefined),
    { message: 'Both startAt and endAt must be provided together' },
  ), validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema & {
        startAt?: string
        endAt?: string
      }
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      // Build where clause for available slots
      const slotWhere: any = {
        type: SlotType.COURT,
        isAvailable: true,
        bookingDetails: {
          none: {}, // Slot has no booking details (not booked)
        },
      }

      // Add date range filter if provided
      if (query.startAt && query.endAt) {
        const startAt = dayjs(query.startAt).toDate()
        const endAt = dayjs(query.endAt).toDate()
        
        slotWhere.AND = [
          {
            startAt: {
              lt: endAt,
            },
          },
          {
            endAt: {
              gt: startAt,
            },
          },
        ]
      } else {
        // If no date filter, ensure AND is an array for the bookingDetails check
        slotWhere.AND = slotWhere.AND || []
      }

      // Find courts that have at least one available, unbooked slot
      const courts = await db.court.findMany({
        ...queryOptions,
        where: {
          isActive: true,
          slot: {
            some: slotWhere,
          },
          ...queryOptions.where,
        },
      })

      for (const court of courts) {
        if (court.image) {
          const imageUrl = await getFileUrl(court.image)
          court.image = imageUrl
        }
      }

      return c.json(ok(courts), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCourtItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const court = await db.court.findUnique({
        where: { id, isActive: true },
      })

      if (!court) {
        throw new NotFoundException('Court not found')
      }

      if (court.image) {
        const imageUrl = await getFileUrl(court.image)
        court.image = imageUrl
      }

      return c.json(ok(court), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCourtHandler: ${error}`)
      throw error
    }
  },
)

export const getCourtSlotsHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('query', availableCourtSlotsQuerySchema, validateHook),
  async (c) => {
    try {
      const { id: courtId } = c.req.valid('param') as IdSchema
      const query = c.req.valid('query') as AvailableCourtSlotsQuerySchema

      // Verify court exists
      const court = await db.court.findUnique({
        where: { id: courtId, isActive: true },
      })

      if (!court) {
        throw new NotFoundException('Court not found')
      }

      // Build where clause
      const where: any = {
        type: SlotType.COURT,
        courtId,
        isAvailable: true,
        bookingDetails: {
          none: {}, // Slot has no booking details (not booked)
        },
      }

      // Add date range filter if provided
      if (query.startAt && query.endAt) {
        const startAt = dayjs(query.startAt).toDate()
        const endAt = dayjs(query.endAt).toDate()
        
        // Find slots that overlap with the requested time range
        // A slot overlaps if: slot.startAt < query.endAt AND slot.endAt > query.startAt
        where.AND = [
          {
            startAt: {
              lt: endAt,
            },
          },
          {
            endAt: {
              gt: startAt,
            },
          },
        ]
      }

      // Query slots
      const slots = await db.slot.findMany({
        where,
        orderBy: {
          startAt: 'asc',
        },
      })

      // Format datetime fields
      const formattedSlots = slots.map((slot) => ({
        ...slot,
        startAt: dayjs(slot.startAt).tz().format(DATETIME_FORMAT),
        endAt: dayjs(slot.endAt).tz().format(DATETIME_FORMAT),
        createdAt: dayjs(slot.createdAt).tz().format(DATETIME_FORMAT),
        updatedAt: dayjs(slot.updatedAt).tz().format(DATETIME_FORMAT),
      }))

      return c.json(ok(formattedSlots), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCourtSlotsHandler: ${error}`)
      throw error
    }
  },
)
