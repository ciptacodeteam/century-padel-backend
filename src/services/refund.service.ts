export type CompletedRefund = {
  type: 'FULL' | 'PARTIAL'
  amount: number
  reason: string
  status: 'COMPLETED'
  refundedAt: string
  terminatedByAdminId?: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function getCompletedRefund(meta: unknown): CompletedRefund | null {
  const refund = asRecord(asRecord(meta)?.refund)
  if (!refund || refund.status !== 'COMPLETED') return null

  const amount = Number(refund.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    type: refund.type === 'FULL' ? 'FULL' : 'PARTIAL',
    amount: Math.round(amount),
    reason: typeof refund.reason === 'string' ? refund.reason : '',
    status: 'COMPLETED',
    refundedAt: typeof refund.refundedAt === 'string' ? refund.refundedAt : '',
    terminatedByAdminId:
      typeof refund.terminatedByAdminId === 'string'
        ? refund.terminatedByAdminId
        : null,
  }
}

export function getCompletedRefundAmount(
  meta: unknown,
  maximumAmount = Number.MAX_SAFE_INTEGER,
) {
  const refund = getCompletedRefund(meta)
  return refund ? Math.min(refund.amount, Math.max(0, maximumAmount)) : 0
}

export function mergeRefundIntoPaymentMeta(
  currentMeta: unknown,
  refund: CompletedRefund,
) {
  return {
    ...(asRecord(currentMeta) ?? {}),
    refund,
  }
}
