import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { getComplimentaryCreditBalance } from '@/services/complimentary-credit.service'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'

const customerParamSchema = z.object({ id: z.string().min(1) })
const creditParamSchema = z.object({
  id: z.string().min(1),
  creditId: z.string().min(1),
})
const grantSchema = z.object({
  minutes: z.number().int().min(30).max(100_000),
  purpose: z.enum(['TRIAL', 'COACHING', 'GOODWILL', 'OTHER']),
  expiresAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(500).optional(),
})
const revokeSchema = z.object({
  note: z.string().trim().max(500).optional(),
})

async function buildCreditSummary(userId: string) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true },
    })
    if (!user) throw new NotFoundException('User not found')

    const [{ totalMinutes }, credits, transactions] = await Promise.all([
      getComplimentaryCreditBalance(tx, userId),
      tx.complimentaryCredit.findMany({
        where: { userId },
        include: {
          grantedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      tx.complimentaryCreditTransaction.findMany({
        where: { credit: { userId } },
        include: {
          staff: { select: { id: true, name: true } },
          booking: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ])

    return { user, totalMinutes, credits, transactions }
  })
}

export const getCustomerComplimentaryCreditsHandler = factory.createHandlers(
  zValidator('param', customerParamSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param')
    return c.json(ok(await buildCreditSummary(id)), status.OK)
  },
)

export const grantComplimentaryCreditHandler = factory.createHandlers(
  zValidator('param', customerParamSchema, validateHook),
  zValidator('json', grantSchema, validateHook),
  async (c) => {
    const { id: userId } = c.req.valid('param')
    const input = c.req.valid('json')
    const admin = c.get('admin')
    if (!admin?.id) throw new BadRequestException('Admin is required')

    const expiresAt = input.expiresAt ? dayjs(input.expiresAt).toDate() : null
    if (expiresAt && !dayjs(expiresAt).isAfter(dayjs())) {
      throw new BadRequestException('Expiry must be in the future')
    }

    await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      })
      if (!user) throw new NotFoundException('User not found')

      const credit = await tx.complimentaryCredit.create({
        data: {
          userId,
          purpose: input.purpose,
          grantedMinutes: input.minutes,
          remainingMinutes: input.minutes,
          expiresAt,
          note: input.note || undefined,
          grantedById: admin.id,
        },
      })
      await tx.complimentaryCreditTransaction.create({
        data: {
          creditId: credit.id,
          type: 'GRANT',
          minutes: input.minutes,
          note: input.note || undefined,
          staffId: admin.id,
        },
      })
    })

    return c.json(
      ok(await buildCreditSummary(userId), 'Complimentary credit granted'),
      status.CREATED,
    )
  },
)

export const revokeComplimentaryCreditHandler = factory.createHandlers(
  zValidator('param', creditParamSchema, validateHook),
  zValidator('json', revokeSchema, validateHook),
  async (c) => {
    const { id: userId, creditId } = c.req.valid('param')
    const { note } = c.req.valid('json')
    const admin = c.get('admin')
    if (!admin?.id) throw new BadRequestException('Admin is required')

    await db.$transaction(async (tx) => {
      const credit = await tx.complimentaryCredit.findFirst({
        where: { id: creditId, userId },
      })
      if (!credit) throw new NotFoundException('Complimentary credit not found')
      if (!credit.isActive || credit.remainingMinutes <= 0) {
        throw new BadRequestException('Credit has no revocable balance')
      }

      await tx.complimentaryCredit.update({
        where: { id: credit.id },
        data: { isActive: false, remainingMinutes: 0 },
      })
      await tx.complimentaryCreditTransaction.create({
        data: {
          creditId: credit.id,
          type: 'REVOKE',
          minutes: credit.remainingMinutes,
          note: note || undefined,
          staffId: admin.id,
        },
      })
    })

    return c.json(
      ok(await buildCreditSummary(userId), 'Complimentary credit revoked'),
      status.OK,
    )
  },
)
