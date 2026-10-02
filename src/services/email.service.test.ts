import { describe, expect, it } from 'vitest'
import { emailTemplates } from './email.service'

describe('email slot timezone', () => {
  it('shows stored Jakarta court hours instead of converting UTC', () => {
    const mail = emailTemplates.bookingConfirmation({
      name: 'Andi',
      invoiceNumber: 'CP-1',
      total: 0,
      invoiceUrl: 'http://localhost:3000/invoice/CP-1',
      items: [
        {
          title: 'Court 2',
          startAt: '2026-09-28T19:00:00.000Z',
          endAt: '2026-09-28T21:00:00.000Z',
          amount: 0,
          coveredByMembership: true,
        },
      ],
      memberships: [],
    })

    expect(mail.html).toContain('19:00 – 21:00')
    expect(mail.html).toContain('Senin, 28 Sep 2026')
    expect(mail.html).not.toContain('02:00')
  })

  it('groups multiple slots under one court with times listed below', () => {
    const mail = emailTemplates.bookingConfirmation({
      name: 'Andi',
      invoiceNumber: 'CP-2',
      total: 750000,
      invoiceUrl: 'http://localhost:3000/invoice/CP-2',
      items: [
        {
          title: 'Court 1',
          startAt: '2026-09-28T19:00:00.000Z',
          endAt: '2026-09-28T20:00:00.000Z',
          amount: 250000,
        },
        {
          title: 'Court 1',
          startAt: '2026-09-28T20:00:00.000Z',
          endAt: '2026-09-28T21:00:00.000Z',
          amount: 250000,
        },
        {
          title: 'Court 1',
          startAt: '2026-09-28T22:00:00.000Z',
          endAt: '2026-09-28T23:00:00.000Z',
          amount: 250000,
        },
        {
          title: 'Court 2',
          startAt: '2026-09-28T19:00:00.000Z',
          endAt: '2026-09-28T20:00:00.000Z',
          amount: 0,
          coveredByMembership: true,
        },
      ],
      memberships: [],
    })

    expect(mail.subject).toBe('Booking Confirmed — 2 courts')
    expect(mail.html.match(/Court 1/g)?.length).toBe(1)
    expect(mail.html).toContain('19:00 – 21:00')
    expect(mail.html).toContain('22:00 – 23:00')
    expect(mail.html).toContain('Court 2')
    expect(mail.html).toContain('Membership')
  })

  it('still converts payment timestamps to Jakarta', () => {
    const mail = emailTemplates.paymentReceipt({
      name: 'Andi',
      invoiceNumber: 'CP-1',
      subtotal: 250000,
      processingFee: 0,
      promoDiscountAmount: 0,
      total: 250000,
      paidAt: '2026-09-28T12:00:00.000Z',
      invoiceUrl: 'http://localhost:3000/invoice/CP-1',
      items: [],
      memberships: [],
    })

    expect(mail.html).toContain('Senin, 28 Sep 2026 · 19:00')
  })
})
