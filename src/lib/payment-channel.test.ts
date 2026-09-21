import { describe, expect, it } from 'vitest'
import {
  isVirtualAccountChannel,
  resolveXenditChannelCode,
} from './payment-channel'

describe('payment channel helpers', () => {
  it('resolves legacy generic VA channels from the payment method name', () => {
    expect(resolveXenditChannelCode('VA', 'BCA Virtual Account')).toBe(
      'BCA_VIRTUAL_ACCOUNT',
    )
    expect(resolveXenditChannelCode('VA', 'Mandiri Virtual Account')).toBe(
      'MANDIRI_VIRTUAL_ACCOUNT',
    )
  })

  it('resolves legacy generic e-wallet channels', () => {
    expect(resolveXenditChannelCode('EWALLET', 'GoPay')).toBe('GOPAY')
    expect(resolveXenditChannelCode('EWALLET', 'OVO')).toBe('OVO')
  })

  it('recognizes official Xendit virtual account channel codes', () => {
    expect(isVirtualAccountChannel('BCA_VIRTUAL_ACCOUNT')).toBe(true)
    expect(isVirtualAccountChannel('MANDIRI_VIRTUAL_ACCOUNT')).toBe(true)
    expect(isVirtualAccountChannel('QRIS')).toBe(false)
  })
})
