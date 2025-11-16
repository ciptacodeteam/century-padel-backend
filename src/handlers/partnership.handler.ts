import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { searchQuerySchema, SearchQuerySchema } from '@/lib/validation'
import { getFileUrl } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

// Public: return only list of logo URLs for active partnerships
export const getPublicPartnershipLogosHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    const query = c.req.valid('query') as SearchQuerySchema
    const queryOptions = buildFindManyOptions(query, {
      defaultOrderBy: { createdAt: 'desc' },
    })

    const items = await db.partnership.findMany({
      ...queryOptions,
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { logo: true },
    })

    const logos: string[] = []
    for (const { logo } of items) {
      if (logo) {
        logos.push(await getFileUrl(logo))
      }
    }

    return c.json(ok(logos), status.OK)
  },
)


