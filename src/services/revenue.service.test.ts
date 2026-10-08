import { beforeEach, describe, expect, it, vi } from 'vitest'
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ db: { invoice: { findMany } } }))
vi.mock('./upload.service', () => ({
  getFileUrl: async (value: string) => value,
}))
import {
  getIncomeBySourceAnalytics,
  getPaymentMethodAnalytics,
} from './analytics.service'
import {
  invoiceRevenue,
  invoiceSource,
  revenueInvoiceWhere,
  revenuePaidAt,
} from './revenue.service'

const start = new Date('2026-09-30T17:00:00Z')
const end = new Date('2026-10-31T16:59:59.999Z')
function invoice(id: string, total: number) {
  return {
    id,
    number: `INV-${id}`,
    total,
    processingFee: 0,
    status: 'PAID',
    paidAt: new Date('2026-10-02T10:00:00Z'),
    issuedAt: new Date('2026-09-25T10:00:00Z'),
    membershipUserId: `membership-${id}`,
    bookingId: null as string | null,
    classBookingId: null as string | null,
    booking: null as {
      id: string
      cashierId: string | null
      status: string
      courtNormalPrice: number
      details: []
    } | null,
    user: { name: 'Customer' },
    payment: null as null | {
      id: string
      status: string
      createdAt: Date
      paidAt: Date
      meta: unknown
      method: { id: string; name: string; channel: string; logo: null }
    },
  }
}
function payment(channel = 'CASHIER', meta: unknown = {}) {
  return {
    id: 'payment-1',
    status: 'PAID',
    createdAt: new Date('2026-09-25T10:00:00Z'),
    paidAt: new Date('2026-10-02T10:00:00Z'),
    meta,
    method: {
      id: channel,
      name: channel === 'CASHIER' ? 'Kasir' : 'Virtual Account',
      channel,
      logo: null,
    },
  }
}
const refund = (amount: number) => ({
  refund: { status: 'COMPLETED', type: 'PARTIAL', amount },
})
beforeEach(() => findMany.mockReset())

describe('invoice-based revenue', () => {
  it('removes all revenue for a cancelled booking, whether refunded or not', () => {
    const purchase = {
      ...invoice('cancelled-court', 500_000),
      membershipUserId: null,
      booking: {
        id: 'b',
        cashierId: 'c',
        status: 'CANCELLED',
        courtNormalPrice: 500_000,
        details: [],
      },
    }
    expect(invoiceRevenue(purchase)).toMatchObject({
      net: 0,
      cancellation: 500_000,
      refund: 0,
    })
    expect(
      invoiceRevenue({
        ...purchase,
        payment: payment('CASHIER', refund(500_000)),
      }),
    ).toMatchObject({ net: 0, cancellation: 0, refund: 500_000 })
  })
  it('deducts only the cancelled court and avoids overlap with its refund', async () => {
    const cancelled = {
      price: 300_000,
      discountPrice: 250_000,
      cancelledAt: new Date(),
      refundAmount: 100_000,
      membershipUserId: null,
      complimentaryCreditMinutes: 0,
    }
    const purchase = {
      ...invoice('partial-cancel', 700_000),
      membershipUserId: null,
      booking: {
        id: 'b',
        cashierId: 'c',
        status: 'CONFIRMED',
        courtNormalPrice: 600_000,
        details: [
          cancelled,
          { ...cancelled, cancelledAt: null, refundAmount: 0 },
        ],
      },
      payment: payment('CASHIER', refund(100_000)),
    }
    expect(invoiceRevenue(purchase)).toMatchObject({
      net: 450_000,
      refund: 100_000,
      cancellation: 150_000,
    })
    findMany.mockResolvedValue([purchase])
    expect((await getPaymentMethodAnalytics(start, end)).summary).toMatchObject(
      { netRevenue: 450_000, totalCancellations: 150_000 },
    )
    expect(
      (await getIncomeBySourceAnalytics(start, end)).summary.totalIncome,
    ).toBe(450_000)
  })
  it('allocates promo discounts to cancelled courts and preserves membership purchases/add-ons', () => {
    const cancelled = {
      price: 500_000,
      discountPrice: 0,
      cancelledAt: new Date(),
      refundAmount: 0,
      membershipUserId: null,
      complimentaryCreditMinutes: 0,
    }
    const purchase = {
      ...invoice('promo', 900_000),
      promoDiscountAmount: 100_000,
      booking: {
        status: 'CONFIRMED',
        courtNormalPrice: 1_000_000,
        details: [cancelled],
      },
    }
    expect(invoiceRevenue(purchase).net).toBe(450_000)
    expect(
      invoiceRevenue({
        ...purchase,
        booking: {
          ...purchase.booking,
          details: [{ ...cancelled, membershipUserId: 'member' }],
        },
      }).net,
    ).toBe(900_000)
    expect(invoiceRevenue(invoice('membership-sale', 50_000_000)).net).toBe(
      50_000_000,
    )
  })
  it('retains collected money after cancellation until a completed refund is recorded', async () => {
    const cancelled = {
      ...invoice('cancelled', 50_000_000),
      status: 'CANCELLED',
    }
    findMany.mockResolvedValue([cancelled])
    expect(
      (await getPaymentMethodAnalytics(start, end)).summary.netRevenue,
    ).toBe(50_000_000)
    expect(invoiceSource(cancelled)).toBe('cashier')
    expect(
      invoiceRevenue({
        ...cancelled,
        payment: { ...payment(), status: 'REFUNDED' },
      }).net,
    ).toBe(0)
  })
  it('includes the legacy Rp50m cashier membership with a newer Rp17m purchase exactly once', async () => {
    const legacy = invoice('old', 50_000_000)
    const current = { ...invoice('new', 17_000_000), payment: payment() }
    findMany.mockResolvedValue([legacy, current])
    const report = await getPaymentMethodAnalytics(start, end)
    expect(report.summary).toMatchObject({
      totalAmount: 67_000_000,
      netRevenue: 67_000_000,
      totalTransactions: 2,
      methodCount: 1,
    })
    expect(report.methods[0]).toMatchObject({
      method: { name: 'Kasir' },
      count: 2,
      total: 67_000_000,
    })
    expect(report.methods[0].transactions).toContainEqual(
      expect.objectContaining({
        invoiceNumber: 'INV-old',
        amount: 50_000_000,
        legacyPayment: true,
      }),
    )
  })
  it('filters cashier/online across membership and booking purchases, not just court relations', async () => {
    findMany.mockResolvedValue([
      invoice('legacy', 50_000_000),
      { ...invoice('online', 20_000_000), payment: payment('VA') },
    ])
    expect(
      (await getPaymentMethodAnalytics(start, end, 'cashier')).summary
        .netRevenue,
    ).toBe(50_000_000)
    expect(
      (await getPaymentMethodAnalytics(start, end, 'online')).summary
        .netRevenue,
    ).toBe(20_000_000)
    const income = await getIncomeBySourceAnalytics(start, end, 'cashier')
    expect(income.summary.membershipIncome).toBe(50_000_000)
    expect(income.summary.cashierIncome).toBe(50_000_000)
  })
  it('counts regular courts/add-ons and classes and preserves unknown paid purchases', async () => {
    const court = {
      ...invoice('court', 500_000),
      membershipUserId: null,
      bookingId: 'booking',
      booking: {
        id: 'booking',
        cashierId: 'cashier',
        status: 'CONFIRMED',
        courtNormalPrice: 500_000,
        details: [],
      },
    }
    const lesson = {
      ...invoice('class', 200_000),
      membershipUserId: null,
      classBookingId: 'class',
      payment: payment('VA'),
    }
    const unknown = { ...invoice('unknown', 100_000), membershipUserId: null }
    findMany.mockResolvedValue([court, lesson, unknown])
    const income = await getIncomeBySourceAnalytics(start, end)
    const methods = await getPaymentMethodAnalytics(start, end)
    expect(income.summary.totalIncome).toBe(800_000)
    expect(methods.summary.netRevenue).toBe(income.summary.totalIncome)
    expect(income.summary.otherIncome).toBe(100_000)
    expect(methods.methods.find((m) => m.method.id === 'unknown')?.total).toBe(
      100_000,
    )
  })
  it('subtracts only completed refunds and does not produce negative revenue for full refunds with fees', async () => {
    const partial = {
      ...invoice('partial', 1_010_000),
      processingFee: 10_000,
      payment: payment('VA', refund(200_000)),
    }
    const full = {
      ...invoice('full', 1_010_000),
      processingFee: 10_000,
      payment: payment('VA', refund(1_010_000)),
    }
    const pendingRefund = {
      ...invoice('pending-refund', 100_000),
      payment: payment('VA', {
        refund: { status: 'PENDING', amount: 100_000 },
      }),
    }
    findMany.mockResolvedValue([partial, full, pendingRefund])
    const result = await getPaymentMethodAnalytics(start, end)
    expect(result.summary.netRevenue).toBe(900_000)
    expect(result.methods[0].netAmount).toBe(900_000)
    expect(
      (await getIncomeBySourceAnalytics(start, end)).summary.totalIncome,
    ).toBe(900_000)
    expect(
      invoiceRevenue({ ...full, status: 'REFUNDED', payment: null }).net,
    ).toBe(0)
  })
  it('retains zero-money membership redemptions without counting package price again', async () => {
    findMany.mockResolvedValue([
      invoice('purchase', 50_000_000),
      {
        ...invoice('redemption', 0),
        membershipUserId: null,
        bookingId: 'booking',
      },
    ])
    expect(
      (await getPaymentMethodAnalytics(start, end)).summary.netRevenue,
    ).toBe(50_000_000)
  })
  it('uses invoice paidAt, never payment creation, with explicit historical fallbacks', () => {
    const purchase = {
      ...invoice('later-paid', 50_000_000),
      payment: payment(),
    }
    expect(revenuePaidAt(purchase)).toEqual(purchase.paidAt)
    expect(revenuePaidAt({ ...purchase, paidAt: null })).toEqual(
      purchase.payment.paidAt,
    )
    expect(revenuePaidAt({ ...purchase, paidAt: null, payment: null })).toEqual(
      purchase.issuedAt,
    )
    const where = revenueInvoiceWhere(start, end)
    expect(where.AND).toEqual([
      {
        OR: [
          { status: { in: ['PAID', 'REFUNDED'] } },
          { paidAt: { not: null } },
          { payment: { status: { in: ['PAID', 'REFUNDED'] } } },
          { payment: { paidAt: { not: null } } },
        ],
      },
    ])
    expect(where.OR?.[0]).toEqual({ paidAt: { gte: start, lte: end } })
    expect(JSON.stringify(where)).not.toContain('createdAt')
  })
  it('queries paid invoices even if no payment row exists or the payment status is stale', async () => {
    findMany.mockResolvedValue([
      {
        ...invoice('stale', 50_000_000),
        payment: { ...payment(), status: 'PENDING' },
      },
    ])
    expect(
      (await getPaymentMethodAnalytics(start, end)).summary.netRevenue,
    ).toBe(50_000_000)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: revenueInvoiceWhere(start, end) }),
    )
  })
  it('identifies cashier metadata while preserving actual payment method grouping', () => {
    expect(
      invoiceSource({
        ...invoice('cashier', 100),
        payment: payment('QRIS', { source: 'cashier' }),
      }),
    ).toBe('cashier')
  })
})
