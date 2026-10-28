import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import onError from '@/middlewares/error'
import route from '@/routes/admin/membership-transaction.route'

const { transaction, reschedule } = vi.hoisted(() => ({
  transaction: vi.fn(),
  reschedule: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ db: { $transaction: transaction } }))
vi.mock('@/services/membership-start-date.service', () => ({
  rescheduleMembershipStart: reschedule,
}))

const payload = {
  startDate: '2099-11-02',
  reason: 'Permintaan pelanggan',
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
    '/admin/membership-transactions/membership-1/start-date',
    {
      method: 'PUT',
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
  reschedule.mockResolvedValue({ id: 'reschedule' })
})
describe('start-date membership endpoint', () => {
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
    expect(reschedule).not.toHaveBeenCalled()
  })
  it('takes administrator identity from the session and membership identity from the URL', async () => {
    const response = await request('ADMIN')
    expect(response.status).toBe(200)
    expect(reschedule).toHaveBeenCalledWith('transaction-client', {
      ...payload,
      membershipUserId: 'membership-1',
      adminId: 'admin-from-session',
    })
  })
  it.each([
    { ...payload, adminId: 'spoofed-admin' },
    { ...payload, userId: 'another-user' },
    { ...payload, endDate: '2099-12-01' },
    { ...payload, startDate: 'bad' },
    { ...payload, reason: ' ' },
  ])(
    'rejects invalid fields or attempts to override identity/expiry %j',
    async (body) => {
      const response = await request('ADMIN', body)
      expect(response.status).toBe(422)
      expect(transaction).not.toHaveBeenCalled()
    },
  )
})
