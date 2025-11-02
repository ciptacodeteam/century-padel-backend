import { TOURNAMENT_SUBDIR } from '@/config'
import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  createTournamentSchema,
  CreateTournamentSchema,
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdateTournamentSchema,
  updateTournamentSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllTournamentHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description', 'location'],
      })

      const tournaments = await db.tournament.findMany({
        ...queryOptions,
      })

      for (const tournament of tournaments) {
        if (tournament.image) {
          const imageUrl = await getFileUrl(tournament.image)
          tournament.image = imageUrl
        }
      }

      return c.json(ok(tournaments), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllTournamentHandler: ${error}`)
      throw error
    }
  },
)

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
        const imageUrl = await getFileUrl(tournament.image)
        tournament.image = imageUrl
      }

      return c.json(ok(tournament), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getTournamentHandler: ${error}`)
      throw error
    }
  },
)

export const createTournamentHandler = factory.createHandlers(
  zValidator('form', createTournamentSchema, validateHook),
  async (c) => {
    try {
      const tournamentData = c.req.valid('form') as CreateTournamentSchema

      let imageUrl: string | undefined = undefined
      if (tournamentData.image) {
        const uploadResult = await uploadFile(tournamentData.image, {
          subdir: TOURNAMENT_SUBDIR,
        })
        imageUrl = uploadResult.relativePath
      }

      const newTournament = await db.tournament.create({
        data: {
          name: tournamentData.name,
          description: tournamentData.description,
          rules: tournamentData.rules,
          image: imageUrl,
          startDate: new Date(tournamentData.startDate),
          endDate: new Date(tournamentData.endDate),
          startTime: tournamentData.startTime,
          endTime: tournamentData.endTime,
          maxTeams: tournamentData.maxTeams,
          teamSize: tournamentData.teamSize,
          entryFee: tournamentData.entryFee,
          location: tournamentData.location,
          isActive: tournamentData.isActive,
        },
      })

      return c.json(ok(newTournament), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createTournamentHandler: ${error}`)
      throw error
    }
  },
)

export const updateTournamentHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateTournamentSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const tournamentData = c.req.valid('form') as Partial<UpdateTournamentSchema>

      const existingTournament = await db.tournament.findUnique({
        where: { id },
      })

      if (!existingTournament) {
        throw new NotFoundException('Tournament not found')
      }

      let imageUrl: string | null = existingTournament.image

      if (tournamentData.image) {
        if (existingTournament.image) {
          await deleteFile(existingTournament.image)
        }
        const uploadResult = await uploadFile(tournamentData.image, {
          subdir: TOURNAMENT_SUBDIR,
        })
        imageUrl = uploadResult.relativePath
      }

      const updatedTournament = await db.tournament.update({
        where: { id },
        data: {
          name: tournamentData.name,
          description: tournamentData.description,
          rules: tournamentData.rules,
          image: imageUrl,
          startDate: tournamentData.startDate
            ? new Date(tournamentData.startDate)
            : undefined,
          endDate: tournamentData.endDate
            ? new Date(tournamentData.endDate)
            : undefined,
          startTime: tournamentData.startTime,
          endTime: tournamentData.endTime,
          maxTeams: tournamentData.maxTeams,
          teamSize: tournamentData.teamSize,
          entryFee: tournamentData.entryFee,
          location: tournamentData.location,
          isActive: tournamentData.isActive,
        },
      })

      return c.json(ok(updatedTournament), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateTournamentHandler: ${error}`)
      throw error
    }
  },
)

export const deleteTournamentHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingTournament = await db.tournament.findUnique({
        where: { id },
      })

      if (!existingTournament) {
        throw new NotFoundException('Tournament not found')
      }

      if (existingTournament.image) {
        await deleteFile(existingTournament.image)
      }

      await db.tournament.delete({
        where: { id },
      })

      return c.json(ok(null, 'Tournament deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteTournamentHandler: ${error}`)
      throw error
    }
  },
)

