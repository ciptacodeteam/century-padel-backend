import { Prisma } from '@prisma/client'
import { db } from '@/lib/prisma'
import { getCompletedRefundAmount } from './refund.service'

export function revenueInvoiceWhere(
  start: Date,
  end: Date,
): Prisma.InvoiceWhereInput {
  const range = { gte: start, lte: end }
  return {
    // Cancelling a booking does not refund money. Older cancellation paths
    // changed invoice/payment status but retained the actual paid timestamp.
    AND: [
      {
        OR: [
          { status: { in: ['PAID', 'REFUNDED'] } },
          { paidAt: { not: null } },
          { payment: { status: { in: ['PAID', 'REFUNDED'] } } },
          { payment: { paidAt: { not: null } } },
        ],
      },
    ],
    OR: [
      { paidAt: range },
      { paidAt: null, payment: { paidAt: range } },
      // Legacy cashier invoices can lack paidAt; their paid invoice issue date
      // is the only available historical timestamp, never payment.createdAt.
      {
        paidAt: null,
        OR: [{ payment: null }, { payment: { paidAt: null } }],
        issuedAt: range,
      },
    ],
  }
}

export const revenueBooking = {
  select: {
    id: true,
    cashierId: true,
    status: true,
    courtNormalPrice: true,
    details: {
      select: {
        price: true,
        discountPrice: true,
        cancelledAt: true,
        refundAmount: true,
        membershipUserId: true,
        complimentaryCreditMinutes: true,
      },
    },
  },
} satisfies Prisma.BookingDefaultArgs

type RevenueInvoice = {
  total: number
  processingFee: number
  status?: string
  promoDiscountAmount?: number
  booking?: {
    status: string
    courtNormalPrice: number
    details: {
      price: number
      discountPrice: number
      cancelledAt: Date | null
      refundAmount: number
      membershipUserId: string | null
      complimentaryCreditMinutes: number
    }[]
  } | null
  payment?: { meta: unknown; status?: string } | null
}

export function invoiceRevenue(invoice: RevenueInvoice) {
  const gross = invoice.total
  const fees = invoice.processingFee
  const refund =
    invoice.status === 'REFUNDED' || invoice.payment?.status === 'REFUNDED'
      ? gross
      : getCompletedRefundAmount(invoice.payment?.meta, gross)
  const base = Math.max(0, gross - fees)
  let cancellation = 0
  if (invoice.booking?.status === 'CANCELLED') {
    // Entire booking is void; any existing refund already reduces its revenue.
    cancellation = Math.max(0, base - refund)
  } else if (invoice.booking) {
    const beforePromo = base + (invoice.promoDiscountAmount ?? 0)
    const ratio = beforePromo > 0 ? base / beforePromo : 0
    let cancelledValue = 0
    let overlappingRefund = 0
    for (const detail of invoice.booking.details) {
      if (!detail.cancelledAt) continue
      // Package redemptions and complimentary court hours generate no new
      // court revenue; cancelling them must not subtract unrelated add-ons.
      const covered =
        detail.membershipUserId ||
        detail.complimentaryCreditMinutes > 0 ||
        invoice.booking.courtNormalPrice === 0
      const value = covered
        ? 0
        : (detail.discountPrice > 0 ? detail.discountPrice : detail.price) *
          ratio
      cancelledValue += value
      overlappingRefund += Math.min(value, detail.refundAmount)
    }
    cancellation = Math.max(
      0,
      Math.min(base, Math.round(cancelledValue)) -
        Math.min(refund, Math.round(overlappingRefund)),
    )
    cancellation = Math.min(cancellation, Math.max(0, base - refund))
  }
  return {
    gross,
    fees,
    refund,
    cancellation,
    net: Math.max(0, base - refund - cancellation),
  }
}

export type RevenueSource = 'cashier' | 'online' | 'unknown'
export function invoiceSource(invoice: {
  status: string
  paidAt?: Date | null
  membershipUserId: string | null
  booking: { cashierId: string | null } | null
  payment: { meta: unknown; method: { channel: string | null } } | null
}): RevenueSource {
  const meta = invoice.payment?.meta as { source?: string } | null
  if (
    invoice.payment?.method.channel === 'CASHIER' ||
    meta?.source === 'cashier' ||
    invoice.booking?.cashierId
  )
    return 'cashier'
  // The old admin membership checkout wrote paid invoices without payments.
  if (
    !invoice.payment &&
    invoice.membershipUserId &&
    (['PAID', 'REFUNDED'].includes(invoice.status) || invoice.paidAt)
  )
    return 'cashier'
  if (invoice.payment) return 'online'
  return 'unknown'
}

export async function getRevenueInvoices(
  start: Date,
  end: Date,
  source?: 'cashier' | 'online',
) {
  const invoices = await db.invoice.findMany({
    where: revenueInvoiceWhere(start, end),
    include: {
      booking: revenueBooking,
      membershipUser: { select: { id: true } },
      classBooking: { select: { id: true } },
      user: { select: { name: true } },
      payment: { include: { method: true } },
    },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
  })
  return invoices.filter(
    (invoice) => !source || invoiceSource(invoice) === source,
  )
}

export function revenuePaidAt(invoice: {
  paidAt: Date | null
  issuedAt: Date
  payment?: { paidAt?: Date | null } | null
}) {
  return invoice.paidAt ?? invoice.payment?.paidAt ?? invoice.issuedAt
}
