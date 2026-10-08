import { BadRequestException, NotFoundException } from '@/exceptions'
import { restoreComplimentaryCreditsForBooking } from '@/services/complimentary-credit.service'
import {
  ensureCashierPaidPayment,
  getCompletedRefundAmount,
} from '@/services/refund.service'
import { BookingStatus, PaymentStatus, Prisma } from '@prisma/client'

type TransactionClient = Prisma.TransactionClient

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : {}
}

export async function correctComplimentaryBookingToCashier(
  tx: TransactionClient,
  input: {
    bookingId: string
    staffId: string
    paidAt: Date
    reason: string
  },
) {
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      details: true,
      invoice: {
        include: { payment: { include: { method: true } } },
      },
    },
  })

  if (!booking) throw new NotFoundException('Booking not found')
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new BadRequestException(
      'Only confirmed bookings can have their payment corrected',
    )
  }
  if (!booking.invoice || booking.invoice.status !== PaymentStatus.PAID) {
    throw new BadRequestException('The booking must have a paid invoice')
  }
  if (
    booking.invoice.payment?.status === PaymentStatus.REFUNDED ||
    getCompletedRefundAmount(booking.invoice.payment?.meta) > 0
  ) {
    throw new BadRequestException('Refunded bookings cannot be corrected')
  }

  const payment = booking.invoice.payment
  const paymentMeta = jsonRecord(payment?.meta)
  if (payment && payment.status !== PaymentStatus.PAID) {
    throw new BadRequestException('The cashier payment must already be paid')
  }
  if (
    payment &&
    payment.method.channel !== 'CASHIER' &&
    paymentMeta.source !== 'cashier'
  ) {
    throw new BadRequestException(
      'Only dashboard cashier bookings can be corrected',
    )
  }
  if (
    booking.invoice.subtotal !== booking.totalPrice ||
    (payment && payment.amount !== booking.invoice.total)
  ) {
    throw new BadRequestException(
      'Booking and invoice totals are inconsistent; manual review is required',
    )
  }

  const coveredDetails = booking.details.filter(
    (detail) =>
      !detail.cancelledAt && detail.complimentaryCreditMinutes > 0,
  )
  const convertedMinutes = coveredDetails.reduce(
    (sum, detail) => sum + detail.complimentaryCreditMinutes,
    0,
  )
  const amount = coveredDetails.reduce(
    (sum, detail) =>
      sum + (detail.discountPrice > 0 ? detail.discountPrice : detail.price),
    0,
  )

  if (convertedMinutes <= 0 || amount <= 0) {
    throw new BadRequestException(
      'This booking has no complimentary court hours to correct',
    )
  }

  const restoredMinutes = await restoreComplimentaryCreditsForBooking(
    tx,
    booking.id,
    input.staffId,
    `Restored for payment correction: ${input.reason}`,
  )
  if (restoredMinutes !== convertedMinutes) {
    throw new BadRequestException(
      'Complimentary balance could not be restored completely',
    )
  }

  const correctedAt = new Date()
  const newSubtotal = booking.invoice.subtotal + amount
  const newTotal = booking.invoice.total + amount
  const audit = {
    type: 'COMPLIMENTARY_TO_CASHIER',
    from: 'complimentary-credit',
    to: 'cashier',
    amount,
    restoredMinutes,
    reason: input.reason,
    correctedByAdminId: input.staffId,
    correctedAt: correctedAt.toISOString(),
    effectivePaidAt: input.paidAt.toISOString(),
  }

  await tx.bookingDetail.updateMany({
    where: {
      id: { in: coveredDetails.map((detail) => detail.id) },
      complimentaryCreditMinutes: { gt: 0 },
      cancelledAt: null,
    },
    data: { complimentaryCreditMinutes: 0 },
  })
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      totalPrice: { increment: amount },
      complimentaryCreditMinutes: {
        decrement: Math.min(
          booking.complimentaryCreditMinutes,
          restoredMinutes,
        ),
      },
      complimentaryCreditValue: {
        decrement: Math.min(booking.complimentaryCreditValue, amount),
      },
      cashierId: input.staffId,
    },
  })
  const invoice = await tx.invoice.update({
    where: { id: booking.invoice.id },
    data: {
      subtotal: newSubtotal,
      total: newTotal,
      status: PaymentStatus.PAID,
      paidAt: input.paidAt,
    },
  })

  let correctedPaymentId: string
  if (payment) {
    const correctedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        amount: newTotal,
        fees: 0,
        status: PaymentStatus.PAID,
        paidAt: input.paidAt,
        meta: {
          ...paymentMeta,
          source: 'cashier',
          paymentCorrection: audit,
        },
      },
      include: { method: true },
    })
    correctedPaymentId = correctedPayment.id
  } else {
    const createdPayment = await ensureCashierPaidPayment(tx, invoice)
    await tx.payment.update({
      where: { id: createdPayment.id },
      data: {
        meta: { source: 'cashier', paymentCorrection: audit },
      },
    })
    correctedPaymentId = createdPayment.id
  }

  return {
    bookingId: booking.id,
    invoiceId: invoice.id,
    paymentId: correctedPaymentId,
    amount,
    restoredMinutes,
    paidAt: input.paidAt,
  }
}
