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
import dayjs from 'dayjs'
import status from 'http-status'
import z from 'zod'

// Validation schema for ban user
const banUserSchema = z.object({
  reason: z.string().min(1).max(500),
  banExpires: z
    .string()
    .optional()
    .refine((val) => !val || dayjs(val).isValid(), {
      message: 'Invalid date format',
    }),
})

type BanUserSchema = z.infer<typeof banUserSchema>

// GET /admin/users
// Get all users
export const getAllUsersHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'email', 'phone'],
      })

      const users = await db.user.findMany({
        ...queryOptions,
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          phone: true,
          phoneVerified: true,
          image: true,
          banned: true,
          banReason: true,
          banExpires: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              bookings: true,
              classBookings: true,
              membershipUser: true,
              invoice: true,
            },
          },
        },
      })

      return c.json(ok(users), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllUsersHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/users/:id
// Get user detail
export const getUserDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const user = await db.user.findUnique({
        where: { id },
        include: {
          bookings: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              createdAt: true,
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
          classBookings: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              createdAt: true,
              class: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              isExpired: true,
              isSuspended: true,
              createdAt: true,
              membership: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
          invoice: {
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
              paidAt: true,
              issuedAt: true,
            },
            take: 10,
            orderBy: { issuedAt: 'desc' },
          },
          clubsLed: {
            select: {
              id: true,
              name: true,
              isActive: true,
              createdAt: true,
            },
          },
          clubMember: {
            select: {
              id: true,
              joinedAt: true,
              isActive: true,
              club: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      return c.json(ok(user), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getUserDetailHandler: ${error}`)
      throw error
    }
  },
)

// POST /admin/users/:id/send-reset-password
// Send reset password OTP link
/**
 * !important
 * Salah Implement
 */
// export const sendResetPasswordLinkHandler = factory.createHandlers(
//   zValidator('param', idSchema, validateHook),
//   async (c) => {
//     try {
//       const { id } = c.req.valid('param') as IdSchema

//       const user = await db.user.findUnique({
//         where: { id },
//       })

//       if (!user) {
//         throw new NotFoundException('User not found')
//       }

//       if (!user.phone) {
//         throw new BadRequestException('User does not have a phone number')
//       }

//       let code = DEFAULT_OTP_CODE
//       let requestId = Math.random().toString(36).substring(2, 30)

//       if (env.nodeEnv === 'production') {
//         code = await generateOtp(OTP_LENGTH)
//         requestId = await sendPhoneOtp(user.phone, code)

//         if (!requestId) {
//           c.var.logger.error(
//             `Failed to find OTP request ID for phone ${user.phone}`,
//           )
//           throw new Error('Failed to send OTP')
//         }
//       }

//       await db.phoneVerification.upsert({
//         where: { phone: user.phone },
//         update: {
//           requestId,
//           code,
//           isUsed: false,
//           type: PhoneVerificationType.FORGOT_PASSWORD,
//           expiresAt: dayjs().add(5, 'minute').toDate(),
//         },
//         create: {
//           requestId,
//           phone: user.phone,
//           code,
//           isUsed: false,
//           type: PhoneVerificationType.FORGOT_PASSWORD,
//           expiresAt: dayjs().add(5, 'minute').toDate(),
//         },
//       })

//       return c.json(
//         ok(
//           {
//             userId: user.id,
//             phone: user.phone,
//             requestId,
//             message:
//               env.nodeEnv === 'production'
//                 ? 'OTP sent successfully to user phone'
//                 : `OTP code: ${code} (development mode)`,
//           },
//           'Reset password OTP sent successfully',
//         ),
//         status.OK,
//       )
//     } catch (error) {
//       c.var.logger.fatal(`Error in sendResetPasswordLinkHandler: ${error}`)
//       throw error
//     }
//   },
// )

// POST /admin/users/:id/send-change-phone
// Send change phone OTP link
/**
 * !important
 * Salah Implement
 */
// export const sendChangePhoneLinkHandler = factory.createHandlers(
//   zValidator('param', idSchema, validateHook),
//   async (c) => {
//     try {
//       const { id } = c.req.valid('param') as IdSchema

//       const user = await db.user.findUnique({
//         where: { id },
//       })

//       if (!user) {
//         throw new NotFoundException('User not found')
//       }

//       if (!user.phone) {
//         throw new BadRequestException('User does not have a phone number')
//       }

//       let code = DEFAULT_OTP_CODE
//       let requestId = Math.random().toString(36).substring(2, 30)

//       if (env.nodeEnv === 'production') {
//         code = await generateOtp(OTP_LENGTH)
//         requestId = await sendPhoneOtp(user.phone, code)

//         if (!requestId) {
//           c.var.logger.error(
//             `Failed to find OTP request ID for phone ${user.phone}`,
//           )
//           throw new Error('Failed to send OTP')
//         }
//       }

//       await db.phoneVerification.upsert({
//         where: { phone: user.phone },
//         update: {
//           requestId,
//           code,
//           isUsed: false,
//           type: PhoneVerificationType.CHANGE_PHONE,
//           expiresAt: dayjs().add(5, 'minute').toDate(),
//         },
//         create: {
//           requestId,
//           phone: user.phone,
//           code,
//           isUsed: false,
//           type: PhoneVerificationType.CHANGE_PHONE,
//           expiresAt: dayjs().add(5, 'minute').toDate(),
//         },
//       })

//       return c.json(
//         ok(
//           {
//             userId: user.id,
//             phone: user.phone,
//             requestId,
//             message:
//               env.nodeEnv === 'production'
//                 ? 'OTP sent successfully to user phone'
//                 : `OTP code: ${code} (development mode)`,
//           },
//           'Change phone OTP sent successfully',
//         ),
//         status.OK,
//       )
//     } catch (error) {
//       c.var.logger.fatal(`Error in sendChangePhoneLinkHandler: ${error}`)
//       throw error
//     }
//   },
// )

// PUT /admin/users/:id/ban
// Ban user
export const banUserHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', banUserSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const banData = c.req.valid('json') as BanUserSchema

      const user = await db.user.findUnique({
        where: { id },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      if (user.banned) {
        throw new BadRequestException('User is already banned')
      }

      const updatedUser = await db.user.update({
        where: { id },
        data: {
          banned: true,
          banReason: banData.reason,
          banExpires: banData.banExpires
            ? dayjs(banData.banExpires).toDate()
            : null,
        },
      })

      return c.json(
        ok(
          updatedUser,
          `User banned successfully${banData.banExpires ? ` until ${banData.banExpires}` : ' permanently'}`,
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in banUserHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/users/:id/unban
// Unban user
export const unbanUserHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const user = await db.user.findUnique({
        where: { id },
      })

      if (!user) {
        throw new NotFoundException('User not found')
      }

      if (!user.banned) {
        throw new BadRequestException('User is not banned')
      }

      const updatedUser = await db.user.update({
        where: { id },
        data: {
          banned: false,
          banReason: null,
          banExpires: null,
        },
      })

      return c.json(ok(updatedUser, 'User unbanned successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in unbanUserHandler: ${error}`)
      throw error
    }
  },
)
