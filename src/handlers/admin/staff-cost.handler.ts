import { DATETIME_FORMAT } from '@/constants'
import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  createStaffCostSchema,
  CreateStaffCostSchema,
  IdSchema,
  idSchema,
  OverrideSingleStaffCostSchema,
  overrideSingleStaffCostSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdateStaffCostSchema,
  updateStaffCostSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { Role, SlotType } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import {
  overrideStaffHourPrice,
  setStaffPricingRange,
  updateStaffPricing,
} from '@/services/costing.service'

export const getStaffCostHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { isAvailable: 'desc' },
        searchableFields: ['price', 'startAt', 'endAt'],
      })

      const items: any = await db.slot.findMany({
        ...queryOptions,
        where: {
          type: { in: [SlotType.COACH, SlotType.BALLBOY] },
          ...queryOptions.where,
        },
      })

      for (const item of items) {
        item['startAt'] = dayjs(item.startAt)
          .startOf('day')
          .format(DATETIME_FORMAT)
        item['endAt'] = dayjs(item.endAt).endOf('day').format(DATETIME_FORMAT)
      }

      return c.json(ok(items, 'Staff cost endpoint is working'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error fetching staff cost: ${error}`)
      throw error
    }
  },
)

export const createStaffCostHandler = factory.createHandlers(
  zValidator('json', createStaffCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as CreateStaffCostSchema
      const {
        staffId,
        fromDate,
        toDate,
        days,
        happyHourPrice,
        peakHourPrice,
        closedHours,
      } = validated

      const existing = await db.staff.findUnique({
        where: { id: staffId },
      })

      if (!existing) {
        throw new NotFoundException('Staff not found')
      }

      if (existing.role === Role.ADMIN) {
        return c.json(
          err(
            'The specified staff cannot have pricing set',
            status.BAD_REQUEST,
          ),
          status.BAD_REQUEST,
        )
      }

      const slotType =
        existing.role === Role.COACH ? SlotType.COACH : SlotType.BALLBOY

      const success = await setStaffPricingRange({
        staffId,
        type: slotType,
        days,
        fromDate,
        happyHourPrice,
        peakHourPrice,
        toDate,
        closedHours,
      })

      if (!success) {
        return c.json(
          err('Failed to set staff pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Staff pricing set successfully'), status.CREATED)
    } catch (error) {
      c.var.logger.error(`Error creating staff cost: ${error}`)
      throw error
    }
  },
)

export const updateStaffCostHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateStaffCostSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const validated = c.req.valid('json') as UpdateStaffCostSchema
      const { date, happyHourPrice, peakHourPrice, closedHours } = validated

      const existing = await db.staff.findUnique({
        where: { id },
      })

      if (!existing) {
        throw new NotFoundException('Staff cost schedule not found')
      }

      if (existing.role === Role.ADMIN) {
        return c.json(
          err(
            'The specified staff cannot have pricing set',
            status.BAD_REQUEST,
          ),
          status.BAD_REQUEST,
        )
      }

      const slotType =
        existing.role === Role.COACH ? SlotType.COACH : SlotType.BALLBOY

      const updated = await updateStaffPricing({
        staffId: id,
        type: slotType,
        date,
        happyHourPrice,
        peakHourPrice,
        closedHours,
      })

      if (!updated) {
        return c.json(
          err('Failed to update staff pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Staff pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating staff cost: ${error}`)
      throw error
    }
  },
)

export const overrideSingleStaffCostHandler = factory.createHandlers(
  zValidator('json', overrideSingleStaffCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as OverrideSingleStaffCostSchema
      const { date, staffId, hour, price } = validated

      const existing = await db.staff.findUnique({
        where: { id: staffId },
      })

      if (!existing) {
        throw new NotFoundException('Staff cost schedule not found')
      }

      if (existing.role === Role.ADMIN) {
        return c.json(
          err(
            'The specified staff cannot have pricing set',
            status.BAD_REQUEST,
          ),
          status.BAD_REQUEST,
        )
      }

      const slotType =
        existing.role === Role.COACH ? SlotType.COACH : SlotType.BALLBOY

      const updated = await overrideStaffHourPrice({
        staffId,
        type: slotType,
        date,
        price,
        hour,
      })

      if (!updated) {
        return c.json(
          err('Failed to override staff pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Staff pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating staff cost: ${error}`)
      throw error
    }
  },
)
