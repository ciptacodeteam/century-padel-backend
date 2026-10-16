import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import { getAvailableCourtSlotsHandler } from './court.handler'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { slot: { findMany } } }))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
})

function app() {
  const router = createRouter()
  router.get('/slots', ...getAvailableCourtSlotsHandler)
  return router
}

describe('admin schedule slot visibility', () => {
  it('retains the booking availability filter by default', async () => {
    const response = await app().request('/slots')
    expect(response.status).toBe(200)
    expect(findMany.mock.calls[0][0].where.AND).not.toHaveLength(0)
    expect(findMany.mock.calls[0][0].where.endAt).toBeDefined()
  })

  it('includes disabled and past slots for the schedule date without the booking filter', async () => {
    const response = await app().request(
      '/slots?includeUnavailable=true&startAt=2026-10-15&endAt=2026-10-15',
    )
    expect(response.status).toBe(200)
    const where = findMany.mock.calls[0][0].where
    expect(where.AND).toHaveLength(2)
    expect(where.AND[0].startAt).toBeDefined()
    expect(where.AND[1].endAt).toBeDefined()
    expect(where.endAt).toBeUndefined()
    expect(where.price).toBeUndefined()
  })
})
