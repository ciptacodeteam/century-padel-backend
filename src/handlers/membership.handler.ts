import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok, err } from '@/lib/response'
import {
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllMembershipHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const items = await db.membership.findMany({
        ...queryOptions,
        include: {
          benefits: true,
        },
      })
      return c.json(ok(items), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getMembershipItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getMembershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const item = await db.membership.findUnique({
        where: { id },
      })

      if (!item) {
        throw new NotFoundException('Membership item not found')
      }

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getMembershipHandler: ${error}`)
      throw error
    }
  },
)

export const getUserMembershipsHandler = factory.createHandlers(
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized', status.UNAUTHORIZED))
      }

      const userMemberships = await db.membershipUser.findMany({
        where: {
          userId: user.id,
        },
        include: {
          membership: {
            include: {
              benefits: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      // Separate active, expired, and suspended memberships
      const now = new Date()
      const activeMemberships = userMemberships.filter(
        (um) => !um.isExpired && !um.isSuspended && um.endDate > now
      )
      const expiredMemberships = userMemberships.filter(
        (um) => um.isExpired || um.endDate <= now
      )
      const suspendedMemberships = userMemberships.filter(
        (um) => um.isSuspended && !um.isExpired && um.endDate > now
      )

      const response = {
        active: activeMemberships,
        expired: expiredMemberships,
        suspended: suspendedMemberships,
        total: userMemberships.length,
      }

      return c.json(ok(response, 'User memberships retrieved successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getUserMembershipsHandler: ${error}`)
      throw error
    }
  },
)