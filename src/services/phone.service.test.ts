import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

import { sendPhoneOtp, verifyPhoneOtp } from './phone.service'

const postMock = vi.mocked(axios.post)

function fazpassSend(id: string, channel: string) {
  return {
    data: {
      status: true,
      message: 'OTP sent',
      code: '200',
      data: {
        id,
        otp: '123456',
        otp_length: 6,
        prefix: '',
        channel,
        provider: 'fazpass',
        purpose: 'verification',
      },
    },
  }
}

describe('Fazpass phone service', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('sends official WhatsApp twice and stores the second request id', async () => {
    postMock
      .mockResolvedValueOnce(fazpassSend('probe-id', 'WhatsApp'))
      .mockResolvedValueOnce(fazpassSend('sent-id', 'WhatsApp'))

    await expect(sendPhoneOtp('+6281234567890', '123456')).resolves.toBe(
      'sent-id',
    )
    expect(postMock).toHaveBeenCalledTimes(2)
    expect(postMock.mock.calls[0]?.[1]).toEqual(postMock.mock.calls[1]?.[1])
  })

  it('does not keep the probe id when the official WhatsApp resend fails', async () => {
    postMock
      .mockResolvedValueOnce(fazpassSend('probe-id', 'WhatsApp'))
      .mockResolvedValueOnce({
        data: { status: false, message: 'Insufficient balance' },
      })

    await expect(sendPhoneOtp('+6281234567890', '123456')).rejects.toThrow(
      'Insufficient balance',
    )
    expect(postMock).toHaveBeenCalledTimes(2)
  })

  it('sends SMS and WhatsApp Long Number only once', async () => {
    postMock.mockResolvedValueOnce(fazpassSend('sms-id', 'sms'))
    await expect(sendPhoneOtp('+6281234567890', '123456')).resolves.toBe(
      'sms-id',
    )

    postMock.mockResolvedValueOnce(
      fazpassSend('long-id', 'WhatsApp Long Number'),
    )
    await expect(sendPhoneOtp('+6281234567890', '123456')).resolves.toBe(
      'long-id',
    )

    expect(postMock).toHaveBeenCalledTimes(2)
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
