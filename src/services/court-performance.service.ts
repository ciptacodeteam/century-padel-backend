import { db } from '@/lib/prisma'
import { getCourtPriceBand } from './court-time-policy.service'

const HOUR = 3_600_000
const DAY = 24 * HOUR
type Package = { id: string; name: string; type: string; sessions: number }
type Detail = {
  id: string
  price: number
  complimentaryCreditMinutes: number
  cancelledAt: Date | null
  membershipUser: { membership: Package } | null
  booking: {
    id: string
    status: string
    createdAt: Date
    courtNormalPrice: number
    user: { id: string; name: string }
    invoice: { id: string; number: string } | null
  }
}
type ReportSlot = {
  id: string
  startAt: Date
  endAt: Date
  isAvailable: boolean
  court: { id: string; name: string } | null
  bookingDetails: Detail[]
}

export function reportBounds(startDate: string, endDate: string) {
  // Court slots store local wall-clock values as UTC, matching schedule APIs.
  return {
    start: new Date(`${startDate}T00:00:00Z`),
    end: new Date(new Date(`${endDate}T00:00:00Z`).getTime() + DAY),
  }
}

export function aggregateCourtPerformance(
  slots: ReportSlot[],
  packages: Package[],
  start: Date,
  end: Date,
  now = new Date(),
) {
  // Only actual timestamps (createdAt / now) need the Jakarta offset.
  const localNow = now.getTime() + 7 * HOUR
  const groups = new Map<
    string,
    {
      id: string
      name: string
      kind: string
      packageHours: number | null
      hours: number
      elapsedHours: number
      upcomingHours: number
      normalValue: number
      bookingIds: Set<string>
      customers: Set<string>
    }
  >()
  const addGroup = (
    id: string,
    name: string,
    kind: string,
    packageHours: number | null = null,
  ) => {
    if (!groups.has(id))
      groups.set(id, {
        id,
        name,
        kind,
        packageHours,
        hours: 0,
        elapsedHours: 0,
        upcomingHours: 0,
        normalValue: 0,
        bookingIds: new Set(),
        customers: new Set(),
      })
    return groups.get(id)!
  }
  addGroup('regular:non-peak', 'Non-membership · Non-Peak', 'regular')
  addGroup('regular:peak', 'Non-membership · Peak', 'regular')
  for (const pkg of packages)
    addGroup(`membership:${pkg.id}`, pkg.name, 'membership', pkg.sessions)

  const details: Array<{
    id: string
    groupId: string
    category: string
    bookingId: string
    customer: string
    court: string
    startAt: string
    endAt: string
    bookedAt: string
    band: string
    hours: number
    elapsedHours: number
    upcomingHours: number
    normalValue: number
    invoiceId: string | null
    invoiceNumber: string | null
  }> = []
  let availableHours = 0
  let elapsedAvailableHours = 0
  for (const slot of slots) {
    const from = Math.max(start.getTime(), slot.startAt.getTime())
    const to = Math.min(end.getTime(), slot.endAt.getTime())
    if (to <= from) continue
    const live = slot.bookingDetails.filter(
      (d) => !d.cancelledAt && ['HOLD', 'CONFIRMED'].includes(d.booking.status),
    )
    if (slot.isAvailable || live.length) {
      availableHours += (to - from) / HOUR
      elapsedAvailableHours += Math.max(0, Math.min(to, localNow) - from) / HOUR
    }
    for (const detail of live.filter((d) => d.booking.status === 'CONFIRMED')) {
      // Split at hour boundaries so slots crossing peak or midnight reconcile.
      for (let cursor = from; cursor < to; ) {
        const segmentEnd = Math.min(to, (Math.floor(cursor / HOUR) + 1) * HOUR)
        const clock = new Date(cursor)
        const band =
          getCourtPriceBand(clock.getUTCDay(), clock.getUTCHours()) ===
          'PEAK_HOUR'
            ? 'Peak'
            : 'Non-Peak'
        const pkg = detail.membershipUser?.membership
        let group
        if (pkg)
          group = addGroup(
            `membership:${pkg.id}`,
            pkg.name,
            'membership',
            pkg.sessions,
          )
        else if (detail.complimentaryCreditMinutes > 0)
          group = addGroup('complimentary', 'Complimentary', 'complimentary')
        else if (detail.booking.courtNormalPrice === 0 || detail.price === 0)
          group = addGroup(
            'unverified',
            'Perlu verifikasi · Paket / harga tidak tercatat',
            'unverified',
          )
        else
          group = groups.get(
            band === 'Peak' ? 'regular:peak' : 'regular:non-peak',
          )!
        const hours = (segmentEnd - cursor) / HOUR
        const elapsedHours =
          Math.max(0, Math.min(segmentEnd, localNow) - cursor) / HOUR
        const upcomingHours = hours - elapsedHours
        const normalValue =
          (detail.price * (segmentEnd - cursor)) /
          (slot.endAt.getTime() - slot.startAt.getTime())
        group.hours += hours
        group.elapsedHours += elapsedHours
        group.upcomingHours += upcomingHours
        group.normalValue += normalValue
        group.bookingIds.add(detail.booking.id)
        group.customers.add(detail.booking.user.id)
        details.push({
          id: `${detail.id}:${cursor}`,
          groupId: group.id,
          category: group.name,
          bookingId: detail.booking.id,
          customer: detail.booking.user.name,
          court: slot.court?.name ?? 'Lapangan tidak tersedia',
          startAt: new Date(cursor).toISOString(),
          endAt: new Date(segmentEnd).toISOString(),
          bookedAt: detail.booking.createdAt.toISOString(),
          band,
          hours,
          elapsedHours,
          upcomingHours,
          normalValue,
          invoiceId: detail.booking.invoice?.id ?? null,
          invoiceNumber: detail.booking.invoice?.number ?? null,
        })
        cursor = segmentEnd
      }
    }
  }
  const rows = [...groups.values()].map(
    ({ bookingIds, customers, ...row }) => ({
      ...row,
      bookings: bookingIds.size,
      customers: customers.size,
    }),
  )
  const hours = rows.reduce((sum, row) => sum + row.hours, 0)
  const elapsedHours = rows.reduce((sum, row) => sum + row.elapsedHours, 0)
  return {
    summary: {
      hours,
      elapsedHours,
      upcomingHours: hours - elapsedHours,
      availableHours,
      occupancy: availableHours > 0 ? (hours / availableHours) * 100 : null,
      elapsedOccupancy:
        elapsedAvailableHours > 0
          ? (elapsedHours / elapsedAvailableHours) * 100
          : null,
      membershipHours: rows
        .filter((r) => r.kind === 'membership')
        .reduce((sum, r) => sum + r.hours, 0),
      regularHours: rows
        .filter((r) => r.kind === 'regular')
        .reduce((sum, r) => sum + r.hours, 0),
    },
    rows,
    details,
    generatedAt: now.toISOString(),
  }
}

export async function getCourtPerformance(
  startDate: string,
  endDate: string,
  courtId?: string,
) {
  const { start, end } = reportBounds(startDate, endDate)
  const [slots, packages, courts] = await Promise.all([
    db.slot.findMany({
      where: {
        type: 'COURT',
        ...(courtId ? { courtId } : {}),
        startAt: { lt: end },
        endAt: { gt: start },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        isAvailable: true,
        court: { select: { id: true, name: true } },
        bookingDetails: {
          select: {
            id: true,
            price: true,
            complimentaryCreditMinutes: true,
            cancelledAt: true,
            membershipUser: {
              select: {
                membership: {
                  select: { id: true, name: true, type: true, sessions: true },
                },
              },
            },
            booking: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                courtNormalPrice: true,
                user: { select: { id: true, name: true } },
                invoice: { select: { id: true, number: true } },
              },
            },
          },
        },
      },
      orderBy: { startAt: 'asc' },
    }),
    db.membership.findMany({
      select: { id: true, name: true, type: true, sessions: true },
      orderBy: [{ sequence: 'asc' }, { name: 'asc' }],
    }),
    db.court.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return {
    ...aggregateCourtPerformance(slots, packages, start, end),
    courts,
    period: { startDate, endDate },
  }
}
