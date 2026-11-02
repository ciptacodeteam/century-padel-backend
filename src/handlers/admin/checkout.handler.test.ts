import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import onError from '@/middlewares/error'
import { adminCheckoutHandler } from './checkout.handler'

const { transaction, consumeMembershipHours, queueEmails } = vi.hoisted(() => ({
  transaction: vi.fn(),
  consumeMembershipHours: vi.fn(),
  queueEmails: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { $transaction: transaction } }))
vi.mock('@/services/membership-complimentary.service', () => ({
  consumeMembershipHours,
}))
vi.mock('@/services/email.service', () => ({
  queueSuperadminInvoiceEmails: queueEmails,
}))
vi.mock('@/services/refund.service', () => ({
  ensureCashierPaidPayment: vi.fn(),
}))
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: vi.fn().mockResolvedValue('INV-TEST'),
  formatPhone: vi.fn(),
}))

function app(role?: string) {
  const router = createRouter()
  router.use('*', async (c, next) => {
    c.set('logger', {
      fatal: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as any)
    if (role) c.set('admin', { id: 'staff-1', role } as any)
    await next()
  })
  router.onError(onError)
  router.post('/checkout', ...adminCheckoutHandler)
  return router
}

function checkout(role: string | undefined, useMembership = true, extra = {}) {
  return app(role).request('/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'customer-1',
      totalHours: 1,
      courtSlots: ['slot-1'],
      useMembership,
      ...extra,
    }),
  })
}

let tx: any
beforeEach(() => {
  vi.clearAllMocks()
  const slot = {
    id: 'slot-1',
    courtId: 'court-1',
    price: 300000,
    discountPrice: null,
    startAt: new Date('2099-11-02T03:00:00Z'),
    endAt: new Date('2099-11-02T04:00:00Z'),
    bookingDetails: [],
  }
  tx = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
    slot: { findMany: vi.fn().mockResolvedValue([slot]), updateMany: vi.fn() },
    membershipUser: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'membership-1',
          remainingSessions: 10,
          membership: { type: 'ALL_HOUR' },
        },
      ]),
    },
    booking: {
      create: vi.fn().mockResolvedValue({ id: 'booking-1' }),
      update: vi.fn(),
    },
    bookingDetail: { create: vi.fn() },
    invoice: {
      create: vi
        .fn()
        .mockResolvedValue({ id: 'invoice-1', number: 'INV-TEST' }),
    },
  }
  transaction.mockImplementation((callback) => callback(tx))
  consumeMembershipHours.mockResolvedValue({ remainingSessions: 9 })
})

describe('admin membership checkout access', () => {
  it.each(['ADMIN', 'ADMIN_VIEWER'])(
    '%s can pay with membership and debit customer hours',
    async (role) => {
      const response = await checkout(role)
      expect(response.status).toBe(200)
      expect(
        ((await response.json()) as { data: { totalPrice: number } }).data
          .totalPrice,
      ).toBe(0)
      expect(consumeMembershipHours).toHaveBeenCalledWith(
        tx,
        'membership-1',
        'booking-1',
        1,
      )
      expect(tx.bookingDetail.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ membershipUserId: 'membership-1' }),
        }),
      )
    },
  )

  it.each(['CASHIER', 'ADMIN_COACHING', 'COACH', 'BALLBOY', undefined])(
    '%s cannot enable membership through the API',
    async (role) => {
      expect((await checkout(role)).status).toBe(403)
      expect(transaction).not.toHaveBeenCalled()
    },
  )

  it.each(['ADMIN', 'ADMIN_VIEWER', 'CASHIER', 'ADMIN_COACHING'])(
    '%s can still book without membership at the regular price',
    async (role) => {
      const response = await checkout(role, false)
      expect(response.status).toBe(200)
      expect(
        ((await response.json()) as { data: { totalPrice: number } }).data
          .totalPrice,
      ).toBe(300000)
      expect(consumeMembershipHours).not.toHaveBeenCalled()
    },
  )

  it('rejects simultaneous membership and complimentary credit before changing balances', async () => {
    expect(
      (await checkout('ADMIN', true, { useComplimentaryCredit: true })).status,
    ).toBe(400)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects unavailable membership', async () => {
    tx.membershipUser.findMany.mockResolvedValue([])
    expect((await checkout('ADMIN_VIEWER')).status).toBe(400)
    expect(consumeMembershipHours).not.toHaveBeenCalled()
    expect(tx.booking.create).not.toHaveBeenCalled()
  })
})
