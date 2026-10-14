import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import {
  xenditWebhookHandler,
  xenditPaymentRequestWebhookHandler,
} from './xendit-webhook.handler'

const { invoice, tx } = vi.hoisted(() => ({
  invoice: { findFirst: vi.fn(), update: vi.fn() },
  tx: {
    $queryRaw: vi.fn(),
    notification: { create: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    payment: { update: vi.fn() },
    membershipUser: { update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({
  db: { invoice, $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) },
}))
vi.mock('@/services/xendit.service', () => ({
  xenditService: { verifyCallbackToken: () => true },
}))
vi.mock('@/services/email.service', () => ({ queuePaidInvoiceEmails: vi.fn() }))
vi.mock('@/services/notification.service', () => ({
  notificationService: {},
  createBookingCancellationNotificationForBooking: vi.fn(),
}))

function app() {
  const router = createRouter()
  router.use('*', async (c, next) => {
    c.set('logger', {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    } as any)
    await next()
  })
  router.post('/request', ...xenditPaymentRequestWebhookHandler)
  router.post('/webhook', ...xenditWebhookHandler)
  return router
}
const record = () => ({
  id: 'invoice-1',
  number: 'INV-1',
  membershipUserId: 'membership-1',
  status: 'PENDING',
  dueDate: new Date('2026-10-13T05:00:00Z'),
  payment: {
    id: 'payment-1',
    status: 'PENDING',
    dueDate: new Date('2026-10-13T05:00:00Z'),
  },
})
beforeEach(() => {
  vi.clearAllMocks()
  invoice.findFirst.mockResolvedValue(record())
  tx.invoice.findUnique.mockResolvedValue(record())
})
const cases = [
  {
    path: '/request',
    payload: {
      event: 'payment_request.expired',
      data: { reference_id: 'INV-1', status: 'EXPIRED' },
    },
  },
  {
    path: '/request',
    payload: {
      event: 'payment_request.failed',
      data: { reference_id: 'INV-1', status: 'FAILED' },
    },
  },
  {
    path: '/webhook',
    payload: {
      event: 'payment.failure',
      data: {
        reference_id: 'INV-1',
        failure_code: 'PAYMENT_AMOUNT_LIMITS_EXCEEDED',
      },
    },
  },
  {
    path: '/webhook',
    payload: {
      event: 'payment_session.expired',
      data: { reference_id: 'INV-1', payment_session_id: 'session-1' },
    },
  },
  { path: '/webhook', payload: { external_id: 'INV-1', status: 'EXPIRED' } },
]
describe('membership gateway failure and timeout callbacks', () => {
  it.each(cases)(
    'cancels unpaid membership for $path $payload.event',
    async ({ path, payload }) => {
      const response = await app().request(path, {
        method: 'POST',
        headers: {
          'x-callback-token': 'test',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(response.status).toBe(200)
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      )
      expect(tx.membershipUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isExpired: true, isSuspended: true }),
        }),
      )
    },
  )
  it('ignores a failure callback arriving after payment was confirmed', async () => {
    tx.invoice.findUnique.mockResolvedValue({ ...record(), status: 'PAID' })
    const response = await app().request('/request', {
      method: 'POST',
      headers: { 'x-callback-token': 'test' },
      body: JSON.stringify(cases[0].payload),
    })
    expect(response.status).toBe(200)
    expect(tx.invoice.update).not.toHaveBeenCalled()
    expect(tx.membershipUser.update).not.toHaveBeenCalled()
  })
})
