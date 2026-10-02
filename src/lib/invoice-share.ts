import { env } from '@/env'
import { createHmac, timingSafeEqual } from 'node:crypto'

export function createInvoiceShareToken(invoiceNumber: string): string {
  return createHmac('sha256', env.jwt.secret)
    .update(`invoice-share:${invoiceNumber}`)
    .digest('base64url')
}

export function verifyInvoiceShareToken(
  invoiceNumber: string,
  token: string | undefined,
): boolean {
  if (!token) return false

  const expected = Buffer.from(createInvoiceShareToken(invoiceNumber))
  const received = Buffer.from(token)

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}
