import { CLUB_SUBDIR } from '@/config'
import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  createClubSchema,
  CreateClubSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  updateClubSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

/**
 * Get all clubs created by the authenticated user
 */
export const getMyClubsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized'), status.UNAUTHORIZED)
      }

      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name'],
      })

      const clubs = await db.club.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          leaderId: user.id,
        },
        include: {
          leader: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
            },
          },
          _count: {
            select: {
              clubMember: true,
            },
          },
        },
      })

      for (const club of clubs) {
        if (club.logo) {
          const logoUrl = await getFileUrl(club.logo)
          club.logo = logoUrl
        }
      }

      return c.json(ok(clubs, 'Success', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in getMyClubsHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Get a specific club by ID (only if user is the leader)
 */
export const getMyClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized'), status.UNAUTHORIZED)
      }

      const { id } = c.req.valid('param') as IdSchema

      const club = await db.club.findUnique({
        where: { id },
        include: {
          leader: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
            },
          },
          _count: {
            select: {
              clubMember: true,
            },
          },
        },
      })

      if (!club) {
        throw new NotFoundException('Club not found')
      }

      // Check if user is the leader of this club
      if (club.leaderId !== user.id) {
        return c.json(
          err('You can only view clubs you created'),
          status.FORBIDDEN,
        )
      }

      if (club.logo) {
        const logoUrl = await getFileUrl(club.logo)
        club.logo = logoUrl
      }

      return c.json(ok(club, 'Success', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in getMyClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Create a new club (user becomes the leader)
 */
export const createMyClubHandler = factory.createHandlers(
  zValidator('form', createClubSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized'), status.UNAUTHORIZED)
      }

      const clubData = c.req.valid('form') as CreateClubSchema

      // Check if user already has a club
      const userClubExists = await db.club.findFirst({
        where: { leaderId: user.id },
      })

      if (userClubExists) {
        return c.json(
          err('You already have a club. Each user can only create one club.'),
          status.BAD_REQUEST,
        )
      }

      // Check if club name is unique
      const clubNameExists = await db.club.findFirst({
        where: { name: clubData.name },
      })

      if (clubNameExists) {
        return c.json(
          err('Club name already exists'),
          status.BAD_REQUEST,
        )
      }
      
      let imageUrl: string | undefined
      if (clubData.logo) {
        const uploadResult = await uploadFile(clubData.logo, {
            subdir: CLUB_SUBDIR,
        })
        imageUrl = uploadResult.relativePath
      }

      const newClub = await db.club.create({
        data: {
          name: clubData.name,
          logo: imageUrl,
          description: clubData.description,
          rules: clubData.rules,
          leaderId: user.id, // Set authenticated user as leader
          visibility: clubData.visibility,
        },
      })

      return c.json(ok(newClub, 'Club created successfully', status.CREATED))
    } catch (error) {
      c.var.logger.fatal(`Error in createMyClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Update a club (only if user is the leader)
 */
export const updateMyClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateClubSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized'), status.UNAUTHORIZED)
      }

      const { id } = c.req.valid('param') as IdSchema
      const clubData = c.req.valid('form') as Partial<CreateClubSchema>

      const existingClub = await db.club.findUnique({
        where: { id },
      })

      if (!existingClub) {
        throw new NotFoundException('Club not found')
      }

      // Check if user is the leader of this club
      if (existingClub.leaderId !== user.id) {
        return c.json(
          err('Only the club leader can update the club'),
          status.FORBIDDEN,
        )
      }

      // Check for name uniqueness if name is being updated
      if (clubData.name && clubData.name !== existingClub.name) {
        const clubNameExists = await db.club.findFirst({
          where: { name: clubData.name },
        })

        if (clubNameExists) {
          return c.json(
            err('Club name already exists'),
            status.BAD_REQUEST,
          )
        }
      }

      let imageUrl: string | null = existingClub.logo
      if (clubData.logo) {
        if (existingClub.logo) {
          await deleteFile(existingClub.logo)
        }

        const uploadResult = await uploadFile(clubData.logo, {
            subdir: CLUB_SUBDIR,
        })
        imageUrl = uploadResult.relativePath
      }

      const updatedClub = await db.club.update({
        where: { id },
        data: {
          name: clubData.name,
          description: clubData.description,
          logo: imageUrl,
          rules: clubData.rules,
          visibility: clubData.visibility,
          // Note: Users cannot change leaderId or isActive - only admins can
        },
      })

      return c.json(ok(updatedClub, 'Club updated successfully', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in updateMyClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Delete a club (only if user is the leader)
 */
export const deleteMyClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized'), status.UNAUTHORIZED)
      }

      const { id } = c.req.valid('param') as IdSchema

      const existingClub = await db.club.findUnique({
        where: { id },
      })

      if (!existingClub) {
        throw new NotFoundException('Club not found')
      }

      // Check if user is the leader of this club
      if (existingClub.leaderId !== user.id) {
        return c.json(
          err('Only the club leader can delete the club'),
          status.FORBIDDEN,
        )
      }

      if (existingClub.logo) {
        await deleteFile(existingClub.logo)
      }

      await db.club.delete({
        where: { id },
      })

      return c.json(ok(null, 'Club deleted successfully', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in deleteMyClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Get all public clubs (for browsing)
 */
export const getAllPublicClubsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const clubs = await db.club.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          visibility: 'PUBLIC',
          isActive: true,
        },
        include: {
          leader: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
            },
          },
          _count: {
            select: {
              clubMember: true,
            },
          },
        },
      })

      for (const club of clubs) {
        if (club.logo) {
          const logoUrl = await getFileUrl(club.logo)
          club.logo = logoUrl
        }
      }

      return c.json(ok(clubs, 'Success', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in getAllPublicClubsHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Get a specific public club by ID
 */
export const getPublicClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const club = await db.club.findUnique({
        where: { 
          id,
        },
        include: {
          leader: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
            },
          },
          clubMember: {
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
          _count: {
            select: {
              clubMember: true,
            },
          },
        },
      })

      if (!club) {
        throw new NotFoundException('Club not found')
      }

      // Only allow viewing public clubs or clubs the user leads
      if (club.visibility !== 'PUBLIC') {
        const user = c.get('user')
        if (!user || club.leaderId !== user.id) {
          return c.json(
            err('This club is private'),
            status.FORBIDDEN,
          )
        }
      }

      if (club.logo) {
        const logoUrl = await getFileUrl(club.logo)
        club.logo = logoUrl
      }

      return c.json(ok(club, 'Success', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in getPublicClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Join a club (authenticated users)
 */
export const joinClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized', status.UNAUTHORIZED))
      }

      const { id } = c.req.valid('param') as IdSchema

      const club = await db.club.findUnique({
        where: { id },
      })

      if (!club) {
        throw new NotFoundException('Club not found')
      }

      // Can't join your own club
      if (club.leaderId === user.id) {
        return c.json(
          err('You cannot join your own club', status.BAD_REQUEST),
        )
      }

      // Check if user is already part of any club (as member or leader)
      const existingClubMembership = await db.clubMember.findFirst({
        where: {
          userId: user.id,
        },
      })

      if (existingClubMembership) {
        return c.json(
          err('You are already a member of another club. Leave it first before joining a new one.', status.BAD_REQUEST),
        )
      }

      // Check if user already leads a club
      const userLeadsClub = await db.club.findFirst({
        where: {
          leaderId: user.id,
        },
      })

      if (userLeadsClub) {
        return c.json(
          err('You already lead a club. You cannot join another club.', status.BAD_REQUEST),
        )
      }

      // Check if already a member of this specific club (redundant but kept for clarity)
      const existingMembership = await db.clubMember.findUnique({
        where: {
          clubId_userId: {
            clubId: id,
            userId: user.id,
          },
        },
      })

      if (existingMembership) {
        return c.json(
          err('You are already a member of this club', status.BAD_REQUEST),
        )
      }

      // Create membership
      const membership = await db.clubMember.create({
        data: {
          clubId: id,
          userId: user.id,
        },
        include: {
          club: {
            select: {
              id: true,
              name: true,
              logo: true,
              visibility: true,
            },
          },
        },
      })

      return c.json(ok(membership, 'Successfully joined the club', status.CREATED))
    } catch (error) {
      c.var.logger.fatal(`Error in joinClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Leave a club (authenticated users)
 */
export const leaveClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized', status.UNAUTHORIZED))
      }

      const { id } = c.req.valid('param') as IdSchema

      const club = await db.club.findUnique({
        where: { id },
      })

      if (!club) {
        throw new NotFoundException('Club not found')
      }

      // Can't leave your own club (you're the leader)
      if (club.leaderId === user.id) {
        return c.json(
          err('You cannot leave your own club. Delete it instead.', status.BAD_REQUEST),
        )
      }

      // Check if user is a member
      const membership = await db.clubMember.findUnique({
        where: {
          clubId_userId: {
            clubId: id,
            userId: user.id,
          },
        },
      })

      if (!membership) {
        return c.json(
          err('You are not a member of this club', status.BAD_REQUEST),
        )
      }

      // Delete membership
      await db.clubMember.delete({
        where: {
          clubId_userId: {
            clubId: id,
            userId: user.id,
          },
        },
      })

      return c.json(ok(null, 'Successfully left the club', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in leaveClubHandler: ${error}`)
      throw error
    }
  },
)