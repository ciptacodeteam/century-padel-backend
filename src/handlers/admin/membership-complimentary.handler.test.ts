import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import onError from '@/middlewares/error'
import route from '@/routes/admin/membership-transaction.route'

const { transaction, grant } = vi.hoisted(() => ({
  transaction: vi.fn(),
  grant: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { $transaction: transaction } }))
vi.mock('@/services/membership-complimentary.service', () => ({
  grantMembershipComplimentary: grant,
}))

const payload = {
  hours: 2,
  reason: 'Kompensasi lapangan',
  requestId: '0db1a187-23bd-4985-8275-8ce1f3da0b40',
}
function app(role?: string) {
  const router = createRouter()
  router.use('*', async (c, next) => {
    c.set('logger', { fatal: vi.fn(), error: vi.fn() } as any)
    if (role) c.set('admin', { id: 'admin-from-session', role } as any)
    else c.set('user', { id: 'ordinary-member' } as any)
    await next()
  })
  router.onError(onError)
  router.route('/admin', route)
  return router
}
function request(role?: string, body: unknown = payload) {
  return app(role).request(
    '/admin/membership-transactions/membership-1/complimentary',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  transaction.mockImplementation(async (callback) =>
    callback('transaction-client'),
  )
  grant.mockResolvedValue({ id: 'grant' })
})
describe('complimentary membership endpoint', () => {
  it.each([
    undefined,
    'CASHIER',
    'ADMIN_VIEWER',
    'ADMIN_COACHING',
    'COACH',
    'BALLBOY',
  ])('rejects role %s before any database mutation', async (role) => {
    const response = await request(role)
    expect(response.status).toBe(role ? 403 : 401)
    expect(transaction).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
  })
  it('takes administrator identity from the session and membership identity from the URL', async () => {
    const response = await request('ADMIN')
    expect(response.status).toBe(200)
    expect(grant).toHaveBeenCalledWith('transaction-client', {
      ...payload,
      membershipUserId: 'membership-1',
      adminId: 'admin-from-session',
    })
  })
  it.each([
    { ...payload, adminId: 'spoofed-admin' },
    { ...payload, userId: 'another-user' },
    { ...payload, endDate: '2099-12-01' },
    { ...payload, hours: -1 },
    { ...payload, hours: 0.5 },
    { ...payload, reason: ' ' },
    { ...payload, requestId: 'bad' },
    { ...payload, hours: 10001 },
  ])(
    'rejects invalid fields or attempts to override identity/expiry %j',
    async (body) => {
      const response = await request('ADMIN', body)
      expect(response.status).toBe(422)
      expect(transaction).not.toHaveBeenCalled()
    },
  )
})

it('does not allow rejecting an already paid membership through a direct API request', async () => {
  const update = vi.fn()
  transaction.mockImplementationOnce(async (callback) =>
    callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      membershipUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            acquisitionType: 'PURCHASE',
            invoice: {
              id: 'invoice',
              status: 'PAID',
              payment: { status: 'PAID' },
            },
          }),
        update,
      },
      invoice: { update },
      payment: { update },
    }),
  )
  const response = await app('ADMIN').request(
    '/admin/membership-transactions/membership-1/reject',
    { method: 'PUT' },
  )
  expect(response.status).toBe(400)
  expect(update).not.toHaveBeenCalled()
})
