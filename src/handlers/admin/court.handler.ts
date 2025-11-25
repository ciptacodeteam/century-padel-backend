import { DATETIME_FORMAT } from '@/constants'
import { COURT_SUBDIR } from '@/config'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  AvailableCourtSlotsQuerySchema,
  availableCourtSlotsQuerySchema,
  CreateCourtSchema,
  createCourtSchema,
  IdSchema,
  idSchema,
  searchQuerySchema,
  SearchQuerySchema,
  UpdateCourtSchema,
  updateCourtSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { BookingStatus, SlotType } from '@prisma/client'
import dayjs from 'dayjs'

export const getAllCourtHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const items = await db.court.findMany({
        ...queryOptions,
      })

      for (const item of items) {
        if (item.image) {
          const imageUrl = await getFileUrl(item.image)
          item.image = imageUrl
        }
      }

      return c.json(ok(items), status.OK)
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

      const item = await db.court.findUnique({
        where: { id },
        include: {
          bookingDetail: true,
          costSchedules: true,
          slot: true,
        },
      })

      if (!item) {
        throw new NotFoundException('Court item not found')
      }

      if (item.image) {
        item.image = await getFileUrl(item.image)
      }

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCourtHandler: ${error}`)
      throw error
    }
  },
)

export const createCourtHandler = factory.createHandlers(
  zValidator('form', createCourtSchema, validateHook),
  async (c) => {
    try {
      const body = c.req.valid('form') as CreateCourtSchema
      const { name, description, image, isActive } = body

      let imageUrl: string | undefined

      if (image) {
        const uploaded = await uploadFile(image, {
          subdir: COURT_SUBDIR,
        })
        imageUrl = uploaded.relativePath
      }

      const newItem = await db.court.create({
        data: {
          name,
          description,
          image: imageUrl,
          isActive: isActive ?? false,
        },
      })

      if (newItem.image) {
        newItem.image = await getFileUrl(newItem.image)
      }

      return c.json(ok(newItem), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createCourt: ${error}`)
      throw error
    }
  },
)

export const updateCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateCourtSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const body = c.req.valid('form') as UpdateCourtSchema
      const { name, description, image, isActive } = body

      const existingItem = await db.court.findUnique({
        where: { id },
      })

      if (!existingItem) {
        throw new NotFoundException('Court item not found')
      }

      let imageUrl = existingItem.image

      if (image) {
        if (existingItem.image) {
          const deleted = await deleteFile(existingItem.image)
          if (deleted) {
            c.var.logger.info(
              `Old image deleted for court ID: ${existingItem.id}`,
            )
          } else {
            c.var.logger.warn(
              `Failed to delete old image for court ID: ${existingItem.id}`,
            )
          }
        }

        const uploaded = await uploadFile(image, {
          subdir: COURT_SUBDIR,
        })
        imageUrl = uploaded.relativePath
      }

      const updatedItem = await db.court.update({
        where: { id },
        data: {
          name: name ?? existingItem.name,
          description: description ?? existingItem.description,
          image: imageUrl,
          isActive: Boolean(
            isActive !== undefined ? isActive : existingItem.isActive,
          ),
        },
      })

      updatedItem.image = await getFileUrl(imageUrl)

      return c.json(ok(updatedItem), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateCourtHandler: ${error}`)
      throw error
    }
  },
)

export const deleteCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingItem = await db.court.findUnique({
        where: { id },
      })

      if (!existingItem) {
        throw new NotFoundException('Court item not found')
      }

      const isAlreadyBooked = await db.bookingDetail.findFirst({
        where: {
          courtId: id,
          booking: {
            status: {
              not: BookingStatus.CANCELLED,
            },
          },
        },
      })

      if (isAlreadyBooked) {
        throw new BadRequestException(
          'Cannot delete court with existing bookings',
        )
      }

      if (existingItem.image) {
        const deleted = await deleteFile(existingItem.image)
        if (deleted) {
          c.var.logger.info(`Image deleted for court ID: ${existingItem.id}`)
        } else {
          c.var.logger.warn(
            `Failed to delete image for court ID: ${existingItem.id}`,
          )
        }
      }

      await db.court.delete({
        where: { id },
      })

      return c.json(ok(null, 'Court item deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteCourtHandler: ${error}`)
      throw error
    }
  },
)

export const getAvailableCourtSlotsHandler = factory.createHandlers(
  zValidator('query', availableCourtSlotsQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as AvailableCourtSlotsQuerySchema & {
        courtId?: string
      }

      const where: any = {
        type: SlotType.COURT,
        // isAvailable: true,
        // bookingDetails: {
        //   none: {},
        // },
        court: {
          isActive: true,
        },
      }

      if (query.courtId) {
        where.courtId = query.courtId
      }

      if (query.startAt && query.endAt) {
        const startAt = dayjs(query.startAt).startOf('day').toDate()
        const endAt = dayjs(query.endAt).endOf('day').toDate()

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

      const slots = await db.slot.findMany({
        where,
        orderBy: {
          startAt: 'asc',
        },
        include: {
          court: true,
        },
      })

      // Transform court images
      for (const slot of slots) {
        if (slot.court?.image) {
          slot.court.image = await getFileUrl(slot.court.image)
        }
      }

      const formattedSlots = slots.map((slot) => ({
        ...slot,
        startAt: dayjs(slot.startAt).format(DATETIME_FORMAT),
        endAt: dayjs(slot.endAt).format(DATETIME_FORMAT),
        createdAt: dayjs(slot.createdAt).format(DATETIME_FORMAT),
        updatedAt: dayjs(slot.updatedAt).format(DATETIME_FORMAT),
      }))

      return c.json(ok(formattedSlots), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableCourtSlotsHandler: ${error}`)
      throw error
    }
  },
)

export const getCostHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const courtCostSlot = await db.$queryRaw`
        SELECT 
          s."startAt"::date AS date,
          json_agg(
            json_build_object(
              'id', s.id,
              'courtId', s."courtId",
              'startAt', s."startAt",
              'endAt', s."endAt",
              'price', s.price,
              'isAvailable', s."isAvailable",
              'createdAt', s."createdAt",
              'updatedAt', s."updatedAt"
            )
          ) AS slots
        FROM slots AS s
        WHERE s."courtId" = ${id}
        GROUP BY date
        ORDER BY date DESC
      `

      if (!courtCostSlot) {
        throw new NotFoundException('Court cost slot not found')
      }

      return c.json(ok(courtCostSlot), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCostHandler: ${error}`)
      throw error
    }
  },
)
