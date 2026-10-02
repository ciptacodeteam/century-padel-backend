import {
  MembershipAcquisitionType,
  PaymentStatus,
  Prisma,
} from '@prisma/client'

/**
 * A membership can fund bookings when it is either a paid purchase or an
 * audited transfer entitlement. Keeping this predicate centralized prevents
 * invoice-less transfer balances from being inconsistently accepted.
 */
export function fundedMembershipWhere(): Prisma.MembershipUserWhereInput {
  return {
    OR: [
      {
        acquisitionType: MembershipAcquisitionType.PURCHASE,
        invoice: { is: { status: PaymentStatus.PAID } },
      },
      {
        acquisitionType: MembershipAcquisitionType.TRANSFER,
        incomingTransfer: { isNot: null },
      },
    ],
  }
}
