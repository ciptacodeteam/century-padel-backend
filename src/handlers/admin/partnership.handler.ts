import { PARTNERSHIP_SUBDIR } from '@/config'
import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  createPartnershipSchema,
  CreatePartnershipSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  updatePartnershipSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllPartnershipHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    const query = c.req.valid('query') as SearchQuerySchema
    const queryOptions = buildFindManyOptions(query, {
      defaultOrderBy: { createdAt: 'desc' },
    })

    const items = await db.partnership.findMany({
      ...queryOptions,
      orderBy: { createdAt: 'desc' },
    })

    for (const item of items) {
      if (item.logo) {
        item.logo = await getFileUrl(item.logo)
      }
    }

    return c.json(ok(items), status.OK)
  },
)

export const getPartnershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param') as IdSchema
    const item = await db.partnership.findUnique({ where: { id } })
    if (!item) {
      throw new NotFoundException('Partnership not found')
    }
    if (item.logo) {
      item.logo = await getFileUrl(item.logo)
    }
    return c.json(ok(item), status.OK)
  },
)

export const createPartnershipHandler = factory.createHandlers(
  zValidator('form', createPartnershipSchema, validateHook),
  async (c) => {
    const data = c.req.valid('form') as CreatePartnershipSchema

    let logoPath = ''
    if (data.logo) {
      const upload = await uploadFile(data.logo, { subdir: PARTNERSHIP_SUBDIR })
      logoPath = upload.relativePath
    }

    const created = await db.partnership.create({
      data: {
        name: data.name,
        description: data.description,
        logo: logoPath,
        isActive: data.isActive ?? true,
      },
    })
    // Normalize logo to absolute URL for response consistency
    if (created.logo) {
      created.logo = await getFileUrl(created.logo)
    }
    return c.json(ok(created), status.CREATED)
  },
)

export const updatePartnershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updatePartnershipSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param') as IdSchema
    const data = c.req.valid('form') as Partial<CreatePartnershipSchema>

    const existing = await db.partnership.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException('Partnership not found')
    }

    let logoPath = existing.logo
    if (data.logo) {
      if (existing.logo) {
        await deleteFile(existing.logo)
      }
      const upload = await uploadFile(data.logo, { subdir: PARTNERSHIP_SUBDIR })
      logoPath = upload.relativePath
    }

    const updated = await db.partnership.update({
      where: { id },
      data: {
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        logo: logoPath,
        isActive:
          typeof data.isActive === 'boolean' ? data.isActive : existing.isActive,
      },
    })
    // Normalize logo to absolute URL for response consistency
    if (updated.logo) {
      updated.logo = await getFileUrl(updated.logo)
    }
    return c.json(ok(updated), status.OK)
  },
)

export const deletePartnershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param') as IdSchema
    const existing = await db.partnership.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException('Partnership not found')
    }

    if (existing.logo) {
      await deleteFile(existing.logo)
    }

    await db.partnership.delete({ where: { id } })
    return c.json(ok({ deleted: true }), status.OK)
  },
)


