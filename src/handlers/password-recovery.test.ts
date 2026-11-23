import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createFactory } from 'hono/factory'
import type { AppEnv } from '@/types'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  verifiedRequest: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({ factory: createFactory() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findUnique: mocks.user },
    phoneVerification: { findFirst: mocks.verifiedRequest },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn(async () => 'hashed-password'),
  verifyPassword: vi.fn(),
}))
vi.mock('@/services/upload.service', () => ({ getFileUrl: vi.fn() }))
vi.mock('@/services/email.service', () => ({
  queueSendTemplatedEmail: vi.fn(),
}))
import { resetPasswordHandler } from './auth.handler'

const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('logger', { error: vi.fn(), info: vi.fn(), fatal: vi.fn() } as any)
  await next()
})
app.post('/reset', ...resetPasswordHandler)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.mockResolvedValue({ id: 'customer-1', phoneVerified: false })
  mocks.transaction.mockImplementation(async (fn) =>
    fn({
      phoneVerification: { delete: mocks.remove },
      user: { update: mocks.update },
    }),
  )
})
const request = () =>
  app.request('/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '+6281234567890',
      requestId: 'request-1',
      newPassword: 'Newpass123!',
    }),
  })

describe('Phone password recovery ownership', () => {
  it('rejects a recovery link without a completed, unexpired OTP verification', async () => {
    mocks.verifiedRequest.mockResolvedValue(null)
    const response = await request()
    expect(response.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.verifiedRequest).toHaveBeenCalledWith({
      where: expect.objectContaining({
        requestId: 'request-1',
        type: 'FORGOT_PASSWORD',
        isUsed: true,
        expiresAt: { gt: expect.any(Date) },
      }),
    })
  })
  it('allows a staff-created customer to reset after OTP verification and consumes the proof', async () => {
    mocks.verifiedRequest.mockResolvedValue({ id: 'proof-1' })
    const response = await request()
    expect(response.status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'proof-1' } })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { password: expect.any(String), phoneVerified: true },
    })
  })
})
