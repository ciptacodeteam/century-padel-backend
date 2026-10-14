import { db } from '@/lib/prisma'
import {
  PaymentStatus,
  Prisma,
  NotificationAudience,
  NotificationType,
} from '@prisma/client'

export function cancelledMembershipData(reason: string) {
  return {
    isExpired: true,
    isSuspended: true,
    suspensionReason: reason,
    suspensionEndDate: null,
  }
}

/** Preserve invoice history and reconcile timeouts even if a webhook/worker was missed. */
export async function expirePendingMembershipPayments(
  now = new Date(),
  scope: { userId?: string; invoiceNumber?: string } = {},
) {
  const overdue = {
    OR: [
      { dueDate: { lte: now } },
      { payment: { is: { dueDate: { lte: now } } } },
    ],
  }
  const invoices = await db.invoice.findMany({
    where: {
      status: PaymentStatus.PENDING,
      membershipUserId: { not: null },
      ...(scope.userId ? { userId: scope.userId } : {}),
      ...(scope.invoiceNumber ? { number: scope.invoiceNumber } : {}),
      ...overdue,
    },
    select: { id: true },
  })
  let cancelled = 0
  for (const candidate of invoices) {
    const changed = await cancelPendingMembershipPayment(
      candidate.id,
      'Waktu pembayaran habis',
      now,
      true,
    )
    if (changed) cancelled++
  }
  return cancelled
}

/** Final gateway failure or timeout; paid and already closed invoices are untouched. */
export async function cancelPendingMembershipPayment(
  invoiceId: string,
  reason: string,
  now = new Date(),
  requireExpired = false,
) {
  return db.$transaction(async (tx) => {
    // Payment callbacks update the invoice first. Lock in the same order,
    // then reread so a concurrent successful payment cannot be cancelled.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`,
    )
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { payment: true },
    })
    if (
      !invoice?.membershipUserId ||
      invoice.status !== PaymentStatus.PENDING ||
      invoice.payment?.status === PaymentStatus.PAID ||
      (requireExpired &&
        invoice.dueDate > now &&
        (!invoice.payment?.dueDate || invoice.payment.dueDate > now))
    )
      return false

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: PaymentStatus.CANCELLED, cancelledAt: now },
    })
    if (invoice.payment && invoice.payment.status === PaymentStatus.PENDING) {
      await tx.payment.update({
        where: { id: invoice.payment.id },
        data: { status: PaymentStatus.CANCELLED, cancelledAt: now },
      })
    }
    await tx.membershipUser.update({
      where: { id: invoice.membershipUserId },
      data: cancelledMembershipData(reason),
    })
    await tx.notification.create({
      data: {
        userId: invoice.userId,
        audience: NotificationAudience.USER,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Pembayaran Membership Dibatalkan',
        message: `${invoice.number}: ${reason}. Silakan buat transaksi baru untuk membeli membership.`,
        data: { invoiceId: invoice.id, invoiceNumber: invoice.number, reason },
      },
    })
    return true
  })
}
