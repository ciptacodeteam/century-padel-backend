import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

import { sendPhoneOtp, verifyPhoneOtp } from './phone.service'

const postMock = vi.mocked(axios.post)

describe('Fazpass phone service', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('returns the Fazpass request ID after a successful send', async () => {
    postMock.mockResolvedValue({
      data: {
        status: true,
        message: 'OTP sent',
        code: '200',
        data: {
          id: 'otp-request-id',
          otp: '123456',
          otp_length: 6,
          prefix: '',
          channel: 'whatsapp',
          provider: 'fazpass',
          purpose: 'verification',
        },
      },
    })

    await expect(sendPhoneOtp('+6281234567890', '123456')).resolves.toBe(
      'otp-request-id',
    )
  })

  it('rejects an HTTP 200 response that Fazpass marks as failed', async () => {
    postMock.mockResolvedValue({
      data: { status: false, message: 'Insufficient balance' },
    })

    await expect(sendPhoneOtp('+6281234567890', '123456')).rejects.toThrow(
      'Insufficient balance',
    )
  })

  it('only accepts an explicit successful verification status', async () => {
    postMock
      .mockResolvedValueOnce({
        data: { status: true, message: 'Verified', code: '200' },
      })
      .mockResolvedValueOnce({
        data: { status: false, message: 'Invalid OTP', code: '400' },
      })

    await expect(verifyPhoneOtp('otp-request-id', '123456')).resolves.toBe(true)
    await expect(verifyPhoneOtp('otp-request-id', '000000')).resolves.toBe(
      false,
    )
  })
})
