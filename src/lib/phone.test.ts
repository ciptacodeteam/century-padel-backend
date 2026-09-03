import { describe, expect, it } from 'vitest'
import { OTP_LENGTH } from '@/constants'
import { phoneSchema, verifyOtpSchema } from './validation'
import { formatPhone, generateOtp } from './utils'

describe('phone OTP helpers', () => {
  it.each([
    ['81234567890', '+6281234567890'],
    ['081234567890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['+6281234567890', '+6281234567890'],
  ])('normalizes %s to %s', async (input, expected) => {
    await expect(formatPhone(input)).resolves.toBe(expected)
  })

  it.each(['81234567890', '081234567890', '6281234567890', '+6281234567890'])(
    'accepts the Indonesian mobile number %s',
    (phone) => {
      expect(phoneSchema.safeParse({ phone }).success).toBe(true)
    },
  )

  it.each(['not-a-phone', '+62123456789', '+12345678901', '08123'])(
    'rejects the invalid mobile number %s',
    (phone) => {
      expect(phoneSchema.safeParse({ phone }).success).toBe(false)
    },
  )

  it('requires a six-digit OTP', () => {
    expect(
      verifyOtpSchema.safeParse({
        phone: '+6281234567890',
        code: '123456',
        requestId: 'request-id',
      }).success,
    ).toBe(true)
    expect(
      verifyOtpSchema.safeParse({
        phone: '+6281234567890',
        code: '1234',
        requestId: 'request-id',
      }).success,
    ).toBe(false)
  })

  it('generates numeric OTPs with the configured length', async () => {
    const codes = await Promise.all(
      Array.from({ length: 20 }, () => generateOtp(OTP_LENGTH)),
    )

    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true)
  })
})
