import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createFactory } from 'hono/factory'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createToken: vi.fn(),
  deleteToken: vi.fn(),
  queueEmail: vi.fn(),
}))
vi.mock('@/lib/create-app', () => ({ factory: createFactory() }))
vi.mock('@/lib/prisma', () => ({
  db: {
    user: { findUnique: mocks.findUnique },
    passwordResetToken: { delete: mocks.deleteToken },
  },
}))
vi.mock('@/env', () => ({ env: { frontEndUrl: 'https://century.example' } }))
vi.mock('@/services/upload.service', () => ({
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}))
vi.mock('@/services/email-queue.service', () => ({
  queueEmail: mocks.queueEmail,
}))
vi.mock('@/services/password-reset.service', () => ({
  createPasswordResetToken: mocks.createToken,
  buildPasswordResetLink: (token: string, base: string) =>
    `${base}/reset-password?token=${token}`,
}))
import { sendResetPasswordLinkHandler } from './user.handler'
import type { AppEnv } from '@/types'

const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  c.set('logger', { error: vi.fn(), info: vi.fn() } as any)
  await next()
})
app.post('/customers/:id/reset', ...sendResetPasswordLinkHandler)
const customer = {
  id: 'customer-1',
  name: 'Customer',
  email: null,
  emailVerified: false,
  phone: '+6281234567890',
  phoneVerified: false,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.findUnique.mockResolvedValue(customer)
  mocks.createToken.mockResolvedValue({
    token: 'secret',
    expiresIn: '24 hours',
    expiresAt: 'tomorrow',
  })
  mocks.queueEmail.mockResolvedValue(undefined)
})
const request = () =>
  app.request('/customers/customer-1/reset', { method: 'POST' })

const readBody = async (response: Response) =>
  (await response.json()) as {
    msg: string
    data: { recoveryUrl: string; channels: string[] }
  }

describe('Admin password recovery', () => {
  it('supports an unverified staff-created phone without issuing a bearer reset token', async () => {
    const response = await request()
    const body = await readBody(response)
    expect(response.status).toBe(200)
    const url = new URL(body.data.recoveryUrl)
    expect(url.pathname).toBe('/forgot-password')
    expect(url.searchParams.get('phone')).toBe(customer.phone)
    expect(url.searchParams.has('token')).toBe(false)
    expect(body.data.channels).toEqual([])
    expect(mocks.createToken).not.toHaveBeenCalled()
    expect(mocks.queueEmail).not.toHaveBeenCalled()
  })
  it('queues a reset token only to verified email', async () => {
    mocks.findUnique.mockResolvedValue({
      ...customer,
      email: 'user@example.com',
      emailVerified: true,
    })
    const response = await request()
    const body = await readBody(response)
    expect(response.status).toBe(200)
    expect(body.data.channels).toEqual(['email'])
    expect(body.data.recoveryUrl).toBeUndefined()
    expect(mocks.queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com' }),
    )
  })
  it('does not send a token to an unverified email', async () => {
    mocks.findUnique.mockResolvedValue({
      ...customer,
      email: 'user@example.com',
    })
    expect((await request()).status).toBe(200)
    expect(mocks.createToken).not.toHaveBeenCalled()
    expect(mocks.queueEmail).not.toHaveBeenCalled()
  })
  it('revokes the token and offers phone recovery when email delivery fails', async () => {
    mocks.findUnique.mockResolvedValue({
      ...customer,
      email: 'user@example.com',
      emailVerified: true,
    })
    mocks.queueEmail.mockRejectedValue(new Error('Queue unavailable'))
    const response = await request()
    expect(response.status).toBe(200)
    expect((await readBody(response)).data.recoveryUrl).toContain(
      '/forgot-password?',
    )
    expect(mocks.deleteToken).toHaveBeenCalledWith({
      where: { token: 'secret' },
    })
  })
  it('reports an email service failure separately from verification status', async () => {
    mocks.findUnique.mockResolvedValue({
      ...customer,
      phone: null,
      email: 'user@example.com',
      emailVerified: true,
    })
    mocks.queueEmail.mockRejectedValue(new Error('Queue unavailable'))
    const response = await request()
    expect(response.status).toBe(502)
    expect((await readBody(response)).msg).toContain('Layanan email')
  })
})
