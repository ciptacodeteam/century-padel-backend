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

      // Check if user is already a leader of a club
      const userClubExists = await db.club.findFirst({
        where: { leaderId: user.id },
      })

      if (userClubExists) {
        return c.json(
          err('You already have a club. Each user can only create one club.'),
          status.BAD_REQUEST,
        )
      }

      // Check if user is already a member of another club
      const membershipExists = await db.clubMember.findFirst({
        where: { userId: user.id },
      })

      if (membershipExists) {
        return c.json(
          err('You are already a member of another club. Each user can only be in one club.'),
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
 * Get all clubs (for browsing) - both public and private
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

      // Allow anyone (authenticated or not) to view club details
      // This allows users to see private clubs before requesting to join

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
 * Request to join a club (for private clubs) or auto-join (for public clubs)
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

      // Check if already a member of this specific club
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

      // For PUBLIC clubs: auto-join immediately
      if (club.visibility === 'PUBLIC') {
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
      }

      // For PRIVATE clubs: create join request
      // Check if already has a pending request
      const existingRequest = await db.clubJoinRequest.findUnique({
        where: {
          clubId_userId: {
            clubId: id,
            userId: user.id,
          },
        },
      })

      if (existingRequest) {
        if (existingRequest.status === 'PENDING') {
          return c.json(
            err('You already have a pending request for this club', status.BAD_REQUEST),
          )
        } else if (existingRequest.status === 'APPROVED') {
          return c.json(
            err('Your request was already approved. You are a member of this club.', status.BAD_REQUEST),
          )
        } else if (existingRequest.status === 'REJECTED') {
          // Allow re-requesting after rejection
          const updatedRequest = await db.clubJoinRequest.update({
            where: { id: existingRequest.id },
            data: { status: 'PENDING' },
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
          return c.json(ok(updatedRequest, 'Join request sent to club leader', status.CREATED))
        }
      }

      const joinRequest = await db.clubJoinRequest.create({
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

      return c.json(ok(joinRequest, 'Join request sent to club leader', status.CREATED))
    } catch (error) {
      c.var.logger.fatal(`Error in joinClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Get all join requests for a club (only club leader)
 */
export const getClubJoinRequestsHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('query', searchQuerySchema, validateHook),
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

      // Only club leader can view requests
      if (club.leaderId !== user.id) {
        return c.json(
          err('Only the club leader can view join requests', status.FORBIDDEN),
        )
      }

      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      const requests = await db.clubJoinRequest.findMany({
        where: {
          clubId: id,
          status: 'PENDING',
        },
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
        },
        orderBy: queryOptions.orderBy,
        take: queryOptions.take,
        skip: queryOptions.skip,
      })

      return c.json(ok(requests, 'Success', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in getClubJoinRequestsHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Approve a join request (only club leader)
 */
export const approveJoinRequestHandler = factory.createHandlers(
  zValidator('param', idSchema.extend({ userId: idSchema.shape.id }), validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized', status.UNAUTHORIZED))
      }

      const { id, userId } = c.req.valid('param') as { id: string; userId: string }

      const club = await db.club.findUnique({
        where: { id },
      })

      if (!club) {
        throw new NotFoundException('Club not found')
      }

      // Only club leader can approve requests
      if (club.leaderId !== user.id) {
        return c.json(
          err('Only the club leader can approve join requests', status.FORBIDDEN),
        )
      }

      const joinRequest = await db.clubJoinRequest.findUnique({
        where: {
          clubId_userId: {
            clubId: id,
            userId: userId,
          },
        },
      })

      if (!joinRequest) {
        throw new NotFoundException('Join request not found')
      }

      if (joinRequest.status !== 'PENDING') {
        return c.json(
          err('This request has already been processed', status.BAD_REQUEST),
        )
      }

      // Create membership and update request status
      await db.$transaction([
        db.clubMember.create({
          data: {
            clubId: id,
            userId: userId,
          },
        }),
        db.clubJoinRequest.update({
          where: { id: joinRequest.id },
          data: { status: 'APPROVED' },
        }),
      ])

      return c.json(ok(null, 'Join request approved', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in approveJoinRequestHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Reject a join request (only club leader)
 */
export const rejectJoinRequestHandler = factory.createHandlers(
  zValidator('param', idSchema.extend({ userId: idSchema.shape.id }), validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized', status.UNAUTHORIZED))
      }

      const { id, userId } = c.req.valid('param') as { id: string; userId: string }

      const club = await db.club.findUnique({
        where: { id },
      })

      if (!club) {
        throw new NotFoundException('Club not found')
      }

      // Only club leader can reject requests
      if (club.leaderId !== user.id) {
        return c.json(
          err('Only the club leader can reject join requests', status.FORBIDDEN),
        )
      }

      const joinRequest = await db.clubJoinRequest.findUnique({
        where: {
          clubId_userId: {
            clubId: id,
            userId: userId,
          },
        },
      })

      if (!joinRequest) {
        throw new NotFoundException('Join request not found')
      }

      if (joinRequest.status !== 'PENDING') {
        return c.json(
          err('This request has already been processed', status.BAD_REQUEST),
        )
      }

      await db.clubJoinRequest.update({
        where: { id: joinRequest.id },
        data: { status: 'REJECTED' },
      })

      return c.json(ok(null, 'Join request rejected', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in rejectJoinRequestHandler: ${error}`)
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

      // Delete membership and join request in a transaction
      await db.$transaction([
        db.clubMember.delete({
          where: {
            clubId_userId: {
              clubId: id,
              userId: user.id,
            },
          },
        }),
        // Delete the join request if it exists (it should exist if they were approved)
        db.clubJoinRequest.deleteMany({
          where: {
            clubId: id,
            userId: user.id,
          },
        }),
      ])

      return c.json(ok(null, 'Successfully left the club', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in leaveClubHandler: ${error}`)
      throw error
    }
  },
)

/**
 * Get club where user is a member (not leader)
 */
export const getMyMembershipHandler = factory.createHandlers(
  async (c) => {
    try {
      const user = c.get('user')
      
      if (!user) {
        return c.json(err('Unauthorized', status.UNAUTHORIZED))
      }

      // First, check if user is a member of a club
      const membership = await db.clubMember.findFirst({
        where: {
          userId: user.id,
          isActive: true,
        },
        include: {
          club: {
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
          },
        },
      })

      if (membership) {
        const club = membership.club

        if (club.logo) {
          const logoUrl = await getFileUrl(club.logo)
          club.logo = logoUrl
        }

        return c.json(ok(club, 'Success', status.OK))
      }

      // If not a member, check if user is a leader of a club
      const leadership = await db.club.findFirst({
        where: {
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

      if (leadership) {
        if (leadership.logo) {
          const logoUrl = await getFileUrl(leadership.logo)
          leadership.logo = logoUrl
        }

        return c.json(ok(leadership, 'Success', status.OK))
      }

      // User is neither a member nor a leader of any club
      return c.json(ok(null, 'Not a member or leader of any club', status.OK))
    } catch (error) {
      c.var.logger.fatal(`Error in getMyMembershipHandler: ${error}`)
      throw error
    }
  },
)