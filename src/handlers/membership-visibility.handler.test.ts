import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '@/lib/create-app'
import onError from '@/middlewares/error'
import {
  getAllMembershipHandler,
  getMembershipHandler,
} from './membership.handler'
import { membershipCheckoutHandler } from './membership-checkout.handler'
import {
  adminMembershipCheckoutHandler,
  createMembershipHandler,
  getAllMembershipHandler as adminList,
  updateMembershipHandler,
} from './admin/membership.handler'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  paymentMethod: vi.fn(),
  user: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    membership: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
    },
    paymentMethod: { findUnique: mocks.paymentMethod },
    user: { findUnique: mocks.user },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/services/email.service', () => ({
  queueSuperadminInvoiceEmails: vi.fn(),
}))
vi.mock('@/services/xendit.service', () => ({ xenditService: {} }))
vi.mock('@/services/schedule-visibility.service', () => ({
  getUserScheduleVisibilityMonths: vi.fn(),
}))

function app() {
  const router = createRouter()
  router.use('*', async (c, next) => {
    c.set('user', { id: 'customer-1' } as any)
    c.set('admin', { id: 'admin-1', role: 'ADMIN_VIEWER' } as any)
    c.set('logger', { fatal: vi.fn(), error: vi.fn() } as any)
    await next()
  })
  router.onError(onError)
  router.get('/memberships', ...getAllMembershipHandler)
  router.get('/memberships/:id', ...getMembershipHandler)
  router.post('/checkout', ...membershipCheckoutHandler)
  router.get('/admin/memberships', ...adminList)
  router.post('/admin/memberships', ...createMembershipHandler)
  router.put('/admin/memberships/:id', ...updateMembershipHandler)
  router.post('/admin/checkout', ...adminMembershipCheckoutHandler)
  return router
}
const payload = {
  name: 'Private package',
  price: 100000,
  sessions: 10,
  duration: 30,
  type: 'ALL_HOUR',
  scheduleVisibilityMonths: 1,
}
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findMany.mockResolvedValue([])
  mocks.findUnique.mockResolvedValue({
    id: 'package-1',
    isActive: true,
    isPublic: false,
  })
})
describe('membership visibility', () => {
  it('forces the public catalog to active public packages even with query filters', async () => {
    const res = await app().request('/memberships?isPublic=false')
    expect(res.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true, isPublic: true }),
      }),
    )
  })
  it('keeps private packages available in the admin catalog', async () => {
    await app().request('/admin/memberships')
    expect(mocks.findMany.mock.calls[0][0].where ?? {}).not.toHaveProperty(
      'isPublic',
    )
  })
  it('hides private package details', async () => {
    const res = await app().request('/memberships/package-1')
    expect(res.status).toBe(404)
  })
  it('allows active public package details', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'package-1',
      isActive: true,
      isPublic: true,
    })
    expect((await app().request('/memberships/package-1')).status).toBe(200)
  })
  it('blocks private package checkout before payment or database writes', async () => {
    const res = await app().request(
      '/checkout',
      json({ membershipId: 'package-1', paymentMethodId: 'payment-1' }),
    )
    expect(res.status).toBe(404)
    expect(mocks.paymentMethod).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('allows admin checkout validation to proceed for a private active package', async () => {
    mocks.user.mockResolvedValue(null)
    const res = await app().request(
      '/admin/checkout',
      json({ membershipId: 'package-1', userId: 'missing-user' }),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ msg: 'User not found' })
    expect(mocks.user).toHaveBeenCalledWith({
      where: { id: 'missing-user' },
      select: { id: true },
    })
  })
  it.each([false, true])(
    'persists isPublic=%s on create and edit',
    async (isPublic) => {
      mocks.create.mockResolvedValue({ id: 'package-1' })
      mocks.update.mockResolvedValue({ id: 'package-1' })
      expect(
        (
          await app().request(
            '/admin/memberships',
            json({ ...payload, isPublic }),
          )
        ).status,
      ).toBe(201)
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublic }),
        }),
      )
      expect(
        (
          await app().request(
            '/admin/memberships/package-1',
            json({ isPublic }, 'PUT'),
          )
        ).status,
      ).toBe(200)
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublic }),
        }),
      )
    },
  )
  it('leaves visibility unchanged when an older client omits it', async () => {
    mocks.update.mockResolvedValue({ id: 'package-1' })
    expect(
      (
        await app().request(
          '/admin/memberships/package-1',
          json({ name: 'Updated name' }, 'PUT'),
        )
      ).status,
    ).toBe(200)
    expect(mocks.update.mock.calls[0][0].data.isPublic).toBeUndefined()
  })
})
