import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as XLSX from 'xlsx'
import { factory } from '@/lib/create-app'
import { ok } from '@/lib/response'
import { validateHook } from '@/helpers/validate-hook'
import { requireAdmin } from '@/middlewares/auth'
import { getCourtPerformance } from '@/services/court-performance.service'

export const courtPerformanceQuery = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    courtId: z.string().min(1).optional(),
  })
  .refine((q) => q.endDate >= q.startDate, {
    message: 'Tanggal akhir harus setelah tanggal awal',
    path: ['endDate'],
  })
  .refine(
    (q) => Date.parse(q.endDate) - Date.parse(q.startDate) < 366 * 86_400_000,
    { message: 'Pilih rentang maksimal 366 hari', path: ['endDate'] },
  )

export const getCourtPerformanceHandler = factory.createHandlers(
  requireAdmin,
  zValidator('query', courtPerformanceQuery, validateHook),
  async (c) => {
    const q = c.req.valid('query')
    return c.json(
      ok(await getCourtPerformance(q.startDate, q.endDate, q.courtId)),
    )
  },
)

export const exportCourtPerformanceHandler = factory.createHandlers(
  requireAdmin,
  zValidator('query', courtPerformanceQuery, validateHook),
  async (c) => {
    const q = c.req.valid('query')
    const report = await getCourtPerformance(q.startDate, q.endDate, q.courtId)
    const workbook = XLSX.utils.book_new()
    const sheets = {
      Informasi: [
        {
          Periode: `${q.startDate} — ${q.endDate}`,
          Lapangan:
            report.courts.find((c) => c.id === q.courtId)?.name ??
            'Semua lapangan',
          'Total jam': report.summary.hours,
          'Jam berlalu': report.summary.elapsedHours,
          'Jam mendatang': report.summary.upcomingHours,
          'Kapasitas slot tercatat': report.summary.availableHours,
          'Occupancy (%)': report.summary.occupancy,
          Catatan:
            'Tanggal main WIB. CONFIRMED, tanpa pembatalan. Jam = durasi lapangan, bukan debit saldo paket. Nilai normal bukan pendapatan. Kapasitas berdasarkan slot yang tersedia atau dipesan saat laporan dibuat.',
        },
      ],
      Rekap: report.rows.map((r) => ({
        Kategori: r.name,
        'Kapasitas paket': r.packageHours,
        'Total jam': r.hours,
        'Jam berlalu': r.elapsedHours,
        'Jam mendatang': r.upcomingHours,
        Booking: r.bookings,
        'Nilai harga normal': r.normalValue,
      })),
      'Detail Booking': report.details.map((d) => ({
        Customer: d.customer,
        Kategori: d.category,
        Lapangan: d.court,
        'Mulai main (WIB)': d.startAt.slice(0, 16).replace('T', ' '),
        'Selesai main (WIB)': d.endAt.slice(0, 16).replace('T', ' '),
        'Dibuat (WIB)': new Date(Date.parse(d.bookedAt) + 7 * 3_600_000)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' '),
        Periode: d.band,
        Jam: d.hours,
        'Jam berlalu': d.elapsedHours,
        'Jam mendatang': d.upcomingHours,
        'Nilai harga normal': d.normalValue,
        Invoice: d.invoiceNumber,
        'Booking ID': d.bookingId,
      })),
    }
    for (const [name, rows] of Object.entries(sheets)) {
      const sheet = XLSX.utils.json_to_sheet(rows)
      sheet['!cols'] = Object.keys(rows[0] ?? {}).map(() => ({ wch: 25 }))
      XLSX.utils.book_append_sheet(workbook, sheet, name)
    }
    c.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    c.header(
      'Content-Disposition',
      `attachment; filename="court-performance-${q.startDate}-${q.endDate}.xlsx"`,
    )
    return c.body(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  },
)
