import dayjs from 'dayjs'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  createPromoCodeSchema,
  CreatePromoCodeSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  updatePromoCodeSchema,
  UpdatePromoCodeSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

const normalizePromoCode = (code: string) => code.trim().toUpperCase()

export const getAllPromoCodeHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    const query = c.req.valid('query') as SearchQuerySchema
    const queryOptions = buildFindManyOptions(query, {
      defaultOrderBy: { createdAt: 'desc' },
      searchableFields: ['name', 'code'],
    })

    const items = await db.promoCode.findMany({
      ...queryOptions,
    })

    return c.json(ok(items), status.OK)
  },
)

export const getPromoCodeHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param') as IdSchema

    const item = await db.promoCode.findUnique({ where: { id } })
    if (!item) {
      throw new NotFoundException('Promo code not found')
    }

    return c.json(ok(item), status.OK)
  },
)

export const createPromoCodeHandler = factory.createHandlers(
  zValidator('json', createPromoCodeSchema, validateHook),
  async (c) => {
    const data = c.req.valid('json') as CreatePromoCodeSchema

    const normalizedCode = normalizePromoCode(data.code)
    const existing = await db.promoCode.findFirst({
      where: { code: normalizedCode },
    })
    if (existing) {
      return c.json(
        err('Promo code already exists', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    }

    const created = await db.promoCode.create({
      data: {
        name: data.name,
        code: normalizedCode,
        discountAmount: data.discountAmount ?? null,
        discountPercent: data.discountPercent ?? null,
        startAt: dayjs(data.startAt).toDate(),
        endAt: dayjs(data.endAt).toDate(),
        status: data.status,
        maxUsage: data.maxUsage,
      },
    })

    return c.json(ok(created), status.CREATED)
  },
)

export const updatePromoCodeHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updatePromoCodeSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param') as IdSchema
    const data = c.req.valid('json') as UpdatePromoCodeSchema

    const existing = await db.promoCode.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException('Promo code not found')
    }

    const nextStartAt = data.startAt
      ? dayjs(data.startAt)
      : dayjs(existing.startAt)
    const nextEndAt = data.endAt ? dayjs(data.endAt) : dayjs(existing.endAt)
    if (nextStartAt.isAfter(nextEndAt)) {
      throw new BadRequestException('startAt must be before or equal to endAt')
    }

    if (data.maxUsage !== undefined && data.maxUsage < existing.usedCount) {
      return c.json(
        err('maxUsage cannot be less than usedCount', status.BAD_REQUEST),
        status.BAD_REQUEST,
      )
    }

    const updateData: Record<string, unknown> = {}

    if (data.name !== undefined) updateData.name = data.name
    if (data.code !== undefined) {
      const normalizedCode = normalizePromoCode(data.code)
      const codeConflict = await db.promoCode.findFirst({
        where: {
          code: normalizedCode,
          id: { not: id },
        },
      })
      if (codeConflict) {
        return c.json(
          err('Promo code already exists', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }
      updateData.code = normalizedCode
    }

    if (data.discountAmount !== undefined) {
      updateData.discountAmount = data.discountAmount
      updateData.discountPercent = null
    }

    if (data.discountPercent !== undefined) {
      updateData.discountPercent = data.discountPercent
      updateData.discountAmount = null
    }

    if (data.startAt !== undefined) {
      updateData.startAt = dayjs(data.startAt).toDate()
    }
    if (data.endAt !== undefined) {
      updateData.endAt = dayjs(data.endAt).toDate()
    }
    if (data.status !== undefined) updateData.status = data.status
    if (data.maxUsage !== undefined) updateData.maxUsage = data.maxUsage

    const updated = await db.promoCode.update({
      where: { id },
      data: updateData,
    })

    return c.json(ok(updated), status.OK)
  },
)

export const deletePromoCodeHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param') as IdSchema

    const existing = await db.promoCode.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException('Promo code not found')
    }

    await db.promoCode.delete({ where: { id } })
    return c.json(ok({ deleted: true }), status.OK)
  },
)
