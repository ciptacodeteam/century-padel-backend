import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expirePendingMembershipPayments } from './membership-payment.service'

const { findMany, tx } = vi.hoisted(() => ({
  findMany: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    notification: { create: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    payment: { update: vi.fn() },
    membershipUser: { update: vi.fn(), delete: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    invoice: { findMany },
    $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
  },
}))
const now = new Date('2026-10-14T05:00:00Z')
const before = new Date('2026-10-13T05:00:00Z')
const after = new Date('2026-10-15T05:00:00Z')
const pendingInvoice = () => ({
  id: 'invoice-1',
  membershipUserId: 'membership-1',
  status: 'PENDING',
  dueDate: before,
  payment: { id: 'payment-1', status: 'PENDING', dueDate: before },
})
beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([{ id: 'invoice-1' }])
  tx.invoice.findUnique.mockResolvedValue(pendingInvoice())
  // Cancellation must preserve history even if deletion is rejected by a database relation.
  tx.membershipUser.delete.mockRejectedValue(
    new Error('Foreign key constraint'),
  )
})

describe('unpaid membership timeouts', () => {
  it('cancels an overdue invoice/payment and keeps the membership history', async () => {
    expect(await expirePendingMembershipPayments(now)).toBe(1)
    expect(tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: { status: 'CANCELLED', cancelledAt: now },
    })
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: { status: 'CANCELLED', cancelledAt: now },
    })
    expect(tx.membershipUser.update).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
      data: {
        isExpired: true,
        isSuspended: true,
        suspensionReason: 'Waktu pembayaran habis',
        suspensionEndDate: null,
      },
    })
    expect(tx.membershipUser.delete).not.toHaveBeenCalled()
  })
  it('expires an invoice without a payment record', async () => {
    tx.invoice.findUnique.mockResolvedValue({
      ...pendingInvoice(),
      payment: null,
    })
    expect(await expirePendingMembershipPayments(now)).toBe(1)
    expect(tx.payment.update).not.toHaveBeenCalled()
  })
  it('uses the payment deadline if it is earlier than the invoice deadline', async () => {
    tx.invoice.findUnique.mockResolvedValue({
      ...pendingInvoice(),
      dueDate: after,
    })
    expect(await expirePendingMembershipPayments(now)).toBe(1)
  })
  it('keeps a still payable invoice pending', async () => {
    tx.invoice.findUnique.mockResolvedValue({
      ...pendingInvoice(),
      dueDate: after,
      payment: { ...pendingInvoice().payment, dueDate: null },
    })
    expect(await expirePendingMembershipPayments(now)).toBe(0)
    expect(tx.invoice.update).not.toHaveBeenCalled()
  })
  it.each(['invoice', 'payment'])(
    'does not cancel when %s became paid before processing',
    async (paid) => {
      const invoice = pendingInvoice()
      if (paid === 'invoice') invoice.status = 'PAID'
      else invoice.payment.status = 'PAID'
      tx.invoice.findUnique.mockResolvedValue(invoice)
      expect(await expirePendingMembershipPayments(now)).toBe(0)
      expect(tx.invoice.update).not.toHaveBeenCalled()
      expect(tx.membershipUser.update).not.toHaveBeenCalled()
    },
  )
  it('does not cancel the same membership twice', async () => {
    await expirePendingMembershipPayments(now)
    tx.invoice.findUnique.mockResolvedValue({
      ...pendingInvoice(),
      status: 'CANCELLED',
    })
    expect(await expirePendingMembershipPayments(now)).toBe(0)
    expect(tx.membershipUser.update).toHaveBeenCalledTimes(1)
    expect(tx.notification.create).toHaveBeenCalledTimes(1)
  })
})
