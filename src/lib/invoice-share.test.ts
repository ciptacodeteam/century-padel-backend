import { describe, expect, it } from 'vitest'
import {
  createInvoiceShareToken,
  verifyInvoiceShareToken,
} from './invoice-share'

describe('invoice share token', () => {
  it('accepts the token only for the invoice it was created for', () => {
    const token = createInvoiceShareToken('INV-001')

    expect(verifyInvoiceShareToken('INV-001', token)).toBe(true)
    expect(verifyInvoiceShareToken('INV-002', token)).toBe(false)
    expect(verifyInvoiceShareToken('INV-001', `${token}x`)).toBe(false)
    expect(verifyInvoiceShareToken('INV-001', undefined)).toBe(false)
  })
})
