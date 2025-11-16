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
} from '@/lib/validation'
import { getFileUrl } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

// GET /tournaments/active
// Returns all ongoing tournaments (current date is between startDate and endDate)
export const getActiveTournamentsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { startDate: 'asc' },
        searchableFields: ['name', 'description', 'location'],
      })

      const today = new Date()
      today.setHours(0, 0, 0, 0) // Start of today

      const tournaments = await db.tournament.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          isActive: true,
          startDate: {
            lte: today,
          },
          endDate: {
            gte: today,
          },
        },
      })

      for (const tournament of tournaments) {
        if (tournament.image) {
          tournament.image = await getFileUrl(tournament.image)
        }
      }

      return c.json(ok(tournaments), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getActiveTournamentsHandler: ${error}`)
      throw error
    }
  },
)

// GET /tournaments
// Returns all tournaments with search/filter support
export const getAllTournamentsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { startDate: 'desc' },
        searchableFields: ['name', 'description', 'location'],
      })

      const tournaments = await db.tournament.findMany({
        ...queryOptions,
      })

      for (const tournament of tournaments) {
        if (tournament.image) {
          tournament.image = await getFileUrl(tournament.image)
        }
      }

      return c.json(ok(tournaments), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllTournamentsHandler: ${error}`)
      throw error
    }
  },
)

// GET /tournaments/:id
// Returns a single tournament by ID
export const getTournamentHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const tournament = await db.tournament.findUnique({
        where: { id },
      })

      if (!tournament) {
        throw new NotFoundException('Tournament not found')
      }

      if (tournament.image) {
        tournament.image = await getFileUrl(tournament.image)
      }

      return c.json(ok(tournament), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getTournamentHandler: ${error}`)
      throw error
    }
  },
)
