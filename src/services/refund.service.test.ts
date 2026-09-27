import { describe, expect, it } from 'vitest'
import {
  canTerminatePaidMembership,
  getCompletedRefund,
  getCompletedRefundAmount,
  mergeRefundIntoPaymentMeta,
} from './refund.service'

const completedRefund = {
  type: 'PARTIAL' as const,
  amount: 250_000,
  reason: 'Permintaan pelanggan',
  status: 'COMPLETED' as const,
  refundedAt: '2026-09-27T07:00:00.000Z',
}

describe('refund service', () => {
  it('membaca refund selesai dari metadata pembayaran', () => {
    expect(getCompletedRefund({ refund: completedRefund })).toEqual({
      ...completedRefund,
      terminatedByAdminId: null,
    })
  })

  it('mengabaikan refund yang belum selesai atau tidak valid', () => {
    expect(
      getCompletedRefundAmount({
        refund: { ...completedRefund, status: 'PENDING' },
      }),
    ).toBe(0)
    expect(
      getCompletedRefundAmount({ refund: { ...completedRefund, amount: 0 } }),
    ).toBe(0)
  })

  it('membatasi pengurang revenue agar tidak melebihi total invoice', () => {
    expect(
      getCompletedRefundAmount(
        { refund: { ...completedRefund, amount: 2_000_000 } },
        1_000_000,
      ),
    ).toBe(1_000_000)
  })

  it('mengizinkan refund membership kasir yang invoice-nya sudah lunas', () => {
    expect(canTerminatePaidMembership({ status: 'PAID' }, null)).toBe(true)
    expect(canTerminatePaidMembership({ status: 'PENDING' }, null)).toBe(false)
    expect(
      canTerminatePaidMembership({ status: 'PAID' }, { status: 'PENDING' }),
    ).toBe(false)
  })

  it('mempertahankan metadata pembayaran lain saat menambahkan refund', () => {
    expect(
      mergeRefundIntoPaymentMeta({ gateway: 'xendit' }, completedRefund),
    ).toEqual({ gateway: 'xendit', refund: completedRefund })
  })
})
