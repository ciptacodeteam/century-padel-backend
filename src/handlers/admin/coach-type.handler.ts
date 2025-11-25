import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  createCoachTypeSchema,
  CreateCoachTypeSchema,
  updateCoachTypeSchema,
  UpdateCoachTypeSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

// GET /admin/coach-types
// Get all coach types with pagination and search
export const getAllCoachTypesHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const coachTypes = await db.bookingCoachType.findMany({
        ...queryOptions,
        include: {
          coachTypeStaffPrice: {
            select: {
              id: true,
              staffId: true,
              basePrice: true,
            },
          },
          bookingCoach: {
            select: {
              id: true,
            },
          },
        },
      })

      return c.json(ok(coachTypes), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllCoachTypesHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/coach-types/:id
// Get single coach type by ID
export const getCoachTypeHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const coachType = await db.bookingCoachType.findUnique({
        where: { id },
        include: {
          coachTypeStaffPrice: {
            select: {
              id: true,
              staffId: true,
              basePrice: true,
              staff: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                },
              },
            },
          },
          bookingCoach: {
            select: {
              id: true,
              price: true,
              createdAt: true,
            },
          },
        },
      })

      if (!coachType) {
        throw new NotFoundException('Coach type not found')
      }

      return c.json(ok(coachType), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCoachTypeHandler: ${error}`)
      throw error
    }
  },
)

// POST /admin/coach-types
// Create a new coach type
export const createCoachTypeHandler = factory.createHandlers(
  zValidator('json', createCoachTypeSchema, validateHook),
  async (c) => {
    try {
      const data = c.req.valid('json') as CreateCoachTypeSchema

      // Check for duplicate name
      const existingCoachType = await db.bookingCoachType.findUnique({
        where: { name: data.name },
      })

      if (existingCoachType) {
        throw new NotFoundException(
          `Coach type with name "${data.name}" already exists`,
        )
      }

      const coachType = await db.bookingCoachType.create({
        data: {
          name: data.name,
          description: data.description,
          isActive: data.isActive ?? true,
        },
      })

      c.var.logger.info(`Coach type created: ${coachType.name}`)
      return c.json(ok(coachType), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createCoachTypeHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/coach-types/:id
// Update coach type
export const updateCoachTypeHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateCoachTypeSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const data = c.req.valid('json') as UpdateCoachTypeSchema

      // Check if coach type exists
      const existingCoachType = await db.bookingCoachType.findUnique({
        where: { id },
      })

      if (!existingCoachType) {
        throw new NotFoundException('Coach type not found')
      }

      // Check for duplicate name if updating name
      if (data.name && data.name !== existingCoachType.name) {
        const duplicateCoachType = await db.bookingCoachType.findUnique({
          where: { name: data.name },
        })

        if (duplicateCoachType) {
          throw new NotFoundException(
            `Coach type with name "${data.name}" already exists`,
          )
        }
      }

      const updatedCoachType = await db.bookingCoachType.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          isActive:
            data.isActive !== undefined ? Boolean(data.isActive) : undefined,
        },
      })

      c.var.logger.info(`Coach type updated: ${updatedCoachType.name}`)
      return c.json(ok(updatedCoachType), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateCoachTypeHandler: ${error}`)
      throw error
    }
  },
)

// DELETE /admin/coach-types/:id
// Delete coach type
export const deleteCoachTypeHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingCoachType = await db.bookingCoachType.findUnique({
        where: { id },
        include: {
          bookingCoach: {
            select: { id: true },
          },
        },
      })

      if (!existingCoachType) {
        throw new NotFoundException('Coach type not found')
      }

      // Check if there are any bookings associated with this coach type
      if (existingCoachType.bookingCoach.length > 0) {
        throw new NotFoundException(
          'Cannot delete coach type with existing bookings',
        )
      }

      const deletedCoachType = await db.bookingCoachType.delete({
        where: { id },
      })

      c.var.logger.info(`Coach type deleted: ${deletedCoachType.name}`)
      return c.json(ok(deletedCoachType), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteCoachTypeHandler: ${error}`)
      throw error
    }
  },
)
