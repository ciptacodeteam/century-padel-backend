import { correctComplimentaryBookingToCashier } from '@/services/complimentary-payment-correction.service'
import { describe, expect, it, vi } from 'vitest'

const paidAt = new Date('2026-09-29T17:00:00.000Z')

function bookingFixture() {
  return {
    id: 'booking-1',
    status: 'CONFIRMED',
    totalPrice: 0,
    complimentaryCreditMinutes: 60,
    complimentaryCreditValue: 380_000,
    details: [
      {
        id: 'detail-1',
        price: 380_000,
        discountPrice: 0,
        complimentaryCreditMinutes: 60,
        cancelledAt: null,
      },
    ],
    invoice: {
      id: 'invoice-1',
      subtotal: 0,
      processingFee: 0,
      total: 0,
      status: 'PAID',
      paidAt: new Date('2026-09-29T13:18:00.000Z'),
      payment: {
        id: 'payment-1',
        amount: 0,
        status: 'PAID',
        meta: { source: 'cashier', existing: true },
        method: { channel: 'CASHIER' },
      },
    },
  }
}

function transaction(booking = bookingFixture()) {
  return {
    booking: {
      findUnique: vi.fn().mockResolvedValue(booking),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    bookingDetail: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    complimentaryCreditTransaction: {
      findMany: vi.fn().mockResolvedValue([
        { creditId: 'credit-1', type: 'REDEEM', minutes: 60 },
      ]),
      create: vi.fn().mockResolvedValue({}),
    },
    complimentaryCredit: { update: vi.fn().mockResolvedValue({}) },
    invoice: {
      update: vi.fn().mockResolvedValue({
        id: 'invoice-1',
        total: 380_000,
        paidAt,
      }),
    },
    paymentMethod: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cashier-method' }),
      upsert: vi.fn(),
    },
    payment: {
      create: vi.fn().mockResolvedValue({ id: 'created-payment' }),
      update: vi.fn().mockResolvedValue({ id: 'payment-1' }),
    },
  }
}

describe('complimentary payment correction', () => {
  it('restores hours and turns the stored slot price into cashier revenue', async () => {
    const tx = transaction()

    const result = await correctComplimentaryBookingToCashier(tx as never, {
      bookingId: 'booking-1',
      staffId: 'admin-1',
      paidAt,
      reason: 'Customer actually paid at the cashier',
    })

    expect(result).toMatchObject({ amount: 380_000, restoredMinutes: 60 })
    expect(tx.complimentaryCredit.update).toHaveBeenCalledWith({
      where: { id: 'credit-1' },
      data: { remainingMinutes: { increment: 60 } },
    })
    expect(tx.complimentaryCreditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'REFUND',
        minutes: 60,
        staffId: 'admin-1',
        note: expect.stringContaining('Customer actually paid'),
      }),
    })
    expect(tx.bookingDetail.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { complimentaryCreditMinutes: 0 } }),
    )
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: expect.objectContaining({
        totalPrice: { increment: 380_000 },
        cashierId: 'admin-1',
      }),
    })
    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 380_000,
          meta: expect.objectContaining({
            source: 'cashier',
            paymentCorrection: expect.objectContaining({
              amount: 380_000,
              restoredMinutes: 60,
              correctedByAdminId: 'admin-1',
            }),
          }),
        }),
      }),
    )
  })

  it('rejects a booking that no longer has complimentary hours', async () => {
    const booking = bookingFixture()
    booking.complimentaryCreditMinutes = 0
    booking.details[0]!.complimentaryCreditMinutes = 0
    const tx = transaction(booking)

    await expect(
      correctComplimentaryBookingToCashier(tx as never, {
        bookingId: 'booking-1',
        staffId: 'admin-1',
        paidAt,
        reason: 'Already corrected previously',
      }),
    ).rejects.toThrow('no complimentary court hours')
    expect(tx.payment.update).not.toHaveBeenCalled()
  })

  it('creates a cashier payment for a legacy complimentary invoice', async () => {
    const booking = bookingFixture()
    booking.invoice.payment = null as never
    const tx = transaction(booking)

    const result = await correctComplimentaryBookingToCashier(tx as never, {
      bookingId: 'booking-1',
      staffId: 'admin-1',
      paidAt,
      reason: 'Legacy booking was paid directly at cashier',
    })

    expect(result.paymentId).toBe('created-payment')
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentMethodId: 'cashier-method',
        amount: 380_000,
        status: 'PAID',
        paidAt,
      }),
    })
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'created-payment' },
      data: {
        meta: expect.objectContaining({
          source: 'cashier',
          paymentCorrection: expect.objectContaining({ amount: 380_000 }),
        }),
      },
    })
  })
})
