import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import onError from '@/middlewares/error'
import route from '@/routes/invoice.route'

const mocks = vi.hoisted(() => ({
  findInvoice: vi.fn(),
  transaction: vi.fn(),
  updateInvoice: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    invoice: { findUnique: mocks.findInvoice },
    $transaction: mocks.transaction,
  },
}))

function app(authenticated = true) {
  const router = createRouter()
  router.use('*', async (c, next) => {
    if (authenticated) c.set('user', { id: 'customer-1' } as any)
    c.set('logger', { fatal: vi.fn(), info: vi.fn(), error: vi.fn() } as any)
    await next()
  })
  router.onError(onError)
  router.route('/', route)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T10:00:00+07:00'))
  mocks.findInvoice.mockResolvedValue({
    id: 'invoice-1',
    userId: 'customer-1',
    status: 'PENDING',
    dueDate: new Date('2026-11-13T10:15:00+07:00'),
    booking: null,
    payment: null,
  })
  mocks.transaction.mockImplementation((callback) =>
    callback({
      invoice: { update: mocks.updateInvoice },
    }),
  )
})
afterEach(() => vi.useRealTimers())

describe('customer booking cancellation access', () => {
  it('rejects direct cancellation before reading or changing booking data', async () => {
    const response = await app().request('/invoices/INV-1/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancel' }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      msg: 'Pembatalan booking hanya dapat dilakukan oleh admin. Silakan hubungi admin.',
    })
    expect(mocks.findInvoice).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('requires authentication on the old cancellation endpoint', async () => {
    const response = await app(false).request(
      '/invoices/INV-1/cancel-booking',
      {
        method: 'POST',
      },
    )
    expect(response.status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it.each(['future', 'missing'])(
    'cannot bypass cancellation through an invoice with a %s deadline',
    async (deadline) => {
      if (deadline === 'missing') {
        const invoice = await mocks.findInvoice()
        mocks.findInvoice.mockResolvedValue({ ...invoice, dueDate: null })
      }
      const response = await app().request('/invoices/invoice-1/expire', {
        method: 'POST',
      })
      expect(response.status).toBe(400)
      expect(mocks.transaction).not.toHaveBeenCalled()
    },
  )

  it('still expires unpaid invoices once their payment deadline has passed', async () => {
    const invoice = await mocks.findInvoice()
    mocks.findInvoice.mockResolvedValue({
      ...invoice,
      dueDate: new Date('2026-11-13T09:59:00+07:00'),
    })
    const response = await app().request('/invoices/invoice-1/expire', {
      method: 'POST',
    })
    expect(response.status).toBe(200)
    expect(mocks.updateInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invoice-1' },
        data: expect.objectContaining({ status: 'EXPIRED' }),
      }),
    )
  })
})
