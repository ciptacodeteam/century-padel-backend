import { MembershipAcquisitionType, PaymentStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { fundedMembershipWhere } from './membership-entitlement.service'

describe('membership entitlement funding', () => {
  it('accepts only paid purchases or transfer records with an audit relation', () => {
    expect(fundedMembershipWhere()).toEqual({
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
    })
  })
})
