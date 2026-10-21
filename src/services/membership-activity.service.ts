import { Prisma } from '@prisma/client'
import { calculateCourtHours } from './membership-hours.service'

export const membershipActivityInclude = {
  membership: { include: { benefits: true } },
  invoice: { select: { number: true, status: true, paidAt: true } },
  complimentaryGrants: { select: { id: true, hours: true, createdAt: true } },
  incomingTransfer: {
    select: {
      id: true,
      transferredHours: true,
      createdAt: true,
      cancelledAt: true,
      fromUser: { select: { name: true } },
    },
  },
  outgoingTransfers: {
    select: {
      id: true,
      transferredHours: true,
      createdAt: true,
      cancelledAt: true,
      toUser: { select: { name: true } },
    },
  },
  bookingDetails: {
    include: {
      court: { select: { name: true } },
      slot: { select: { startAt: true, endAt: true } },
      booking: {
        select: {
          status: true,
          cancelledAt: true,
          invoice: { select: { number: true } },
        },
      },
    },
  },
} satisfies Prisma.MembershipUserInclude

type MembershipRecord = Prisma.MembershipUserGetPayload<{
  include: typeof membershipActivityInclude
}>

type Activity = {
  id: string
  membershipUserId: string
  type:
    | 'PURCHASE'
    | 'BOOKING'
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT'
    | 'RETURN'
    | 'COMPLIMENTARY'
  title: string
  hours: number
  occurredAt: Date
  reference: string
  complimentaryHours?: number
  counterpart?: string
  court?: string
  startAt?: Date
  endAt?: Date
  status: 'COMPLETED' | 'HOLD' | 'CANCELLED'
  // Cancelled events have a separate reversal; each row retains its original sign.
}

export function buildMembershipActivity(
  records: MembershipRecord[],
  now = new Date(),
) {
  const events: Activity[] = []
  const memberships = records
    .filter(
      (record) =>
        record.acquisitionType === 'TRANSFER' ||
        record.invoice?.status === 'PAID',
    )
    .map((record) => {
      const baseHours =
        record.incomingTransfer?.transferredHours ?? record.membership.sessions
      const allocatedHours =
        baseHours + (record.totalComplimentarySessions ?? 0)
      const transferredOutHours = record.outgoingTransfers
        .filter((transfer) => !transfer.cancelledAt)
        .reduce((sum, transfer) => sum + transfer.transferredHours, 0)
      let bookingHours = 0
      let heldHours = 0
      const add = (event: Omit<Activity, 'membershipUserId'>) =>
        events.push({ ...event, membershipUserId: record.id })

      if (record.acquisitionType === 'PURCHASE') {
        add({
          id: `purchase-${record.id}`,
          type: 'PURCHASE',
          title: 'Pembelian membership',
          hours: baseHours,
          occurredAt: record.invoice?.paidAt ?? record.createdAt,
          reference: record.invoice?.number ?? record.id,
          status: 'COMPLETED',
        })
      }
      for (const grant of record.complimentaryGrants ?? []) {
        add({
          id: `complimentary-${grant.id}`,
          type: 'COMPLIMENTARY',
          title: 'Kuota complimentary',
          hours: grant.hours,
          occurredAt: grant.createdAt,
          reference: grant.id,
          status: 'COMPLETED',
        })
      }
      const incoming = record.incomingTransfer
      if (incoming) {
        add({
          id: `incoming-${incoming.id}`,
          type: 'TRANSFER_IN',
          title: `Transfer dari ${incoming.fromUser.name}`,
          counterpart: incoming.fromUser.name,
          hours: incoming.transferredHours,
          occurredAt: incoming.createdAt,
          reference: incoming.id,
          status: incoming.cancelledAt ? 'CANCELLED' : 'COMPLETED',
        })
        if (incoming.cancelledAt)
          add({
            id: `revoke-${incoming.id}`,
            type: 'RETURN',
            title: 'Jam transfer dikembalikan ke pengirim',
            counterpart: incoming.fromUser.name,
            hours: -incoming.transferredHours,
            occurredAt: incoming.cancelledAt,
            reference: incoming.id,
            status: 'COMPLETED',
          })
      }
      for (const transfer of record.outgoingTransfers) {
        add({
          id: `outgoing-${transfer.id}`,
          type: 'TRANSFER_OUT',
          title: `Transfer ke ${transfer.toUser.name}`,
          counterpart: transfer.toUser.name,
          hours: -transfer.transferredHours,
          occurredAt: transfer.createdAt,
          reference: transfer.id,
          status: transfer.cancelledAt ? 'CANCELLED' : 'COMPLETED',
        })
        if (transfer.cancelledAt)
          add({
            id: `return-${transfer.id}`,
            type: 'RETURN',
            title: 'Pengembalian transfer yang dibatalkan',
            counterpart: transfer.toUser.name,
            hours: transfer.transferredHours,
            occurredAt: transfer.cancelledAt,
            reference: transfer.id,
            status: 'COMPLETED',
          })
      }
      for (const detail of record.bookingDetails) {
        const hours = calculateCourtHours([detail.slot])
        const cancelled =
          !!detail.cancelledAt || detail.booking.status === 'CANCELLED'
        const held = detail.booking.status === 'HOLD'
        if (!cancelled) {
          if (held) heldHours += hours
          else bookingHours += hours
        }
        const reference = detail.booking.invoice?.number ?? detail.bookingId
        const court = detail.court?.name ?? 'Lapangan'
        const slot = {
          court,
          startAt: detail.slot.startAt,
          endAt: detail.slot.endAt,
        }
        add({
          id: `booking-${detail.id}`,
          type: 'BOOKING',
          title: `Booking ${court}`,
          complimentaryHours: detail.complimentaryMembershipHours ?? 0,
          hours: -hours,
          occurredAt: detail.createdAt,
          reference,
          ...slot,
          status: cancelled ? 'CANCELLED' : held ? 'HOLD' : 'COMPLETED',
        })
        const cancelledAt = detail.cancelledAt ?? detail.booking.cancelledAt
        if (cancelled && cancelledAt)
          add({
            id: `refund-${detail.id}`,
            type: 'RETURN',
            title: 'Pengembalian jam booking',
            complimentaryHours: detail.complimentaryMembershipHours ?? 0,
            hours,
            occurredAt: cancelledAt,
            reference,
            ...slot,
            status: 'COMPLETED',
          })
      }
      const revoked = !!incoming?.cancelledAt
      // Do not infer booking use from balance differences: legacy records and
      // manual adjustments may not have an attributable booking detail.
      const untrackedHours = Math.max(
        0,
        allocatedHours -
          record.remainingSessions -
          transferredOutHours -
          bookingHours -
          heldHours -
          (revoked ? allocatedHours : 0),
      )
      return {
        id: record.id,
        name: record.membership.name,
        createdAt: record.createdAt,
        endDate: record.endDate,
        allocatedHours,
        remainingHours: record.remainingSessions,
        complimentaryHours: record.totalComplimentarySessions ?? 0,
        remainingComplimentaryHours: record.remainingComplimentarySessions ?? 0,
        bookingHours,
        heldHours,
        transferredOutHours,
        untrackedHours,
        transferredInHours:
          incoming && !revoked ? incoming.transferredHours : 0,
        status: revoked
          ? 'CANCELLED'
          : record.isSuspended
            ? 'SUSPENDED'
            : record.isExpired || record.endDate <= now
              ? 'EXPIRED'
              : record.startDate > now
                ? 'UPCOMING'
                : 'ACTIVE',
      }
    })
  events.sort(
    (a, b) =>
      b.occurredAt.getTime() - a.occurredAt.getTime() ||
      a.id.localeCompare(b.id),
  )
  return { memberships, events }
}
