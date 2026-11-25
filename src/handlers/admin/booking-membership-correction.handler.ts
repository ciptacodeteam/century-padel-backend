import { zValidator } from '@hono/zod-validator'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { idSchema } from '@/lib/validation'
import { validateHook } from '@/helpers/validate-hook'
import { ok } from '@/lib/response'
import { BadRequestException } from '@/exceptions'
import {
  correctBookingToPaidMembership,
  getBookingMembershipCorrectionOptions,
} from '@/services/booking-membership-correction.service'

export const bookingMembershipCorrectionOptionsHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) =>
    c.json(
      ok(
        await db.$transaction((tx) =>
          getBookingMembershipCorrectionOptions(tx, c.req.valid('param').id),
        ),
      ),
    ),
)

export const correctBookingMembershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator(
    'json',
    z
      .object({
        membershipUserId: z.string().min(1),
        reason: z.string().trim().min(5).max(500),
      })
      .strict(),
    validateHook,
  ),
  async (c) => {
    try {
      const result = await db.$transaction(
        (tx) =>
          correctBookingToPaidMembership(tx, {
            ...c.req.valid('json'),
            bookingId: c.req.valid('param').id,
            adminId: c.get('admin')!.id,
          }),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      )
      return c.json(
        ok(result, 'Pemakaian berhasil dialihkan ke paket berbayar'),
      )
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      ) {
        throw new BadRequestException(
          'Data berubah atau booking sudah dikoreksi. Muat ulang sebelum mencoba lagi.',
        )
      }
      throw error
    }
  },
)
