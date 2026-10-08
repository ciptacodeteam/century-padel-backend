import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@prisma/client'
import * as XLSX from 'xlsx'
import { createRouter } from '@/lib/create-app'
import {
  courtPerformanceQuery,
  exportCourtPerformanceHandler,
  getCourtPerformanceHandler,
} from './court-performance.handler'

const { getReport } = vi.hoisted(() => ({ getReport: vi.fn() }))
vi.mock('@/services/court-performance.service', () => ({
  getCourtPerformance: getReport,
}))

function app(role: Role | null) {
  const router = createRouter()
  router.use('*', async (c, next) => {
    c.set(
      'admin',
      role ? { id: 'staff-1', email: 'test@example.com', role } : null,
    )
    await next()
  })
  router.get('/report', ...getCourtPerformanceHandler)
  router.get('/export', ...exportCourtPerformanceHandler)
  return router
}
const query = '?startDate=2026-10-01&endDate=2026-10-31'
beforeEach(() => getReport.mockReset())

describe('court performance endpoints', () => {
  it.each([
    null,
    'CASHIER',
    'ADMIN_VIEWER',
    'COACH',
    'ADMIN_COACHING',
  ] as const)('protects both JSON and Excel from role %s', async (role) => {
    for (const endpoint of ['/report', '/export']) {
      const res = await app(role).request(endpoint + query)
      expect(res.status).toBe(role ? 403 : 401)
    }
    expect(getReport).not.toHaveBeenCalled()
  })
  it.each([
    { startDate: '2026-02-30', endDate: '2026-03-01' },
    { startDate: '2026-10-31', endDate: '2026-10-01' },
    { startDate: '2025-01-01', endDate: '2026-10-31' },
  ])('rejects invalid ranges %j', (range) => {
    expect(courtPerformanceQuery.safeParse(range).success).toBe(false)
  })
  it('requires explicit dates and returns validation errors before querying', async () => {
    const res = await app('ADMIN').request('/report')
    expect(res.status).toBe(422)
    expect(getReport).not.toHaveBeenCalled()
  })
  it('passes the requested court and date range to the report', async () => {
    getReport.mockResolvedValue({ rows: [] })
    const res = await app('ADMIN').request(
      '/report' + query + '&courtId=court-1',
    )
    expect(res.status).toBe(200)
    expect(getReport).toHaveBeenCalledWith(
      '2026-10-01',
      '2026-10-31',
      'court-1',
    )
  })
  it('exports a readable workbook with summary, zero-use packages and booking detail', async () => {
    getReport.mockResolvedValue({
      courts: [],
      summary: {
        hours: 0,
        elapsedHours: 0,
        upcomingHours: 0,
        availableHours: 20,
        occupancy: 0,
      },
      rows: [
        {
          name: 'All Day 50 Hours',
          packageHours: 50,
          hours: 0,
          elapsedHours: 0,
          upcomingHours: 0,
          bookings: 0,
          normalValue: 0,
        },
      ],
      details: [],
    })
    const res = await app('ADMIN').request('/export' + query)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain(
      '2026-10-01-2026-10-31.xlsx',
    )
    const book = XLSX.read(await res.arrayBuffer(), { type: 'array' })
    expect(book.SheetNames).toEqual(['Informasi', 'Rekap', 'Detail Booking'])
    expect(XLSX.utils.sheet_to_json(book.Sheets.Rekap)).toEqual([
      expect.objectContaining({ Kategori: 'All Day 50 Hours', 'Total jam': 0 }),
    ])
  })
})
