import { BadRequestException } from '@/exceptions'
import {
  MembershipAcquisitionType,
  PaymentStatus,
  Prisma,
} from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { transferMembershipBalance } from './membership-transfer.service'

const now = new Date('2026-10-02T05:00:00.000Z')
const source = {
  id: 'membership-source',
  userId: 'user-source',
  membershipId: 'package-1',
  startDate: new Date('2026-09-01T00:00:00.000Z'),
  endDate: new Date('2026-11-01T00:00:00.000Z'),
  remainingSessions: 10,
  isExpired: false,
  isSuspended: false,
  acquisitionType: MembershipAcquisitionType.PURCHASE,
  user: { id: 'user-source', name: 'Budi' },
  membership: { id: 'package-1', name: 'Happy Hour', type: 'HAPPY_HOUR' },
  invoice: {
    status: PaymentStatus.PAID,
    payment: { meta: null as Prisma.JsonValue },
  },
}

function createTx(overrides?: {
  source?: Omit<typeof source, 'acquisitionType'> & {
    acquisitionType: MembershipAcquisitionType
  }
  claimCount?: number
  recipient?: { id: string; name: string; banned: boolean }
  admin?: { id: string } | null
}) {
  const destination = {
    id: 'membership-destination',
    userId: 'user-target',
    membershipId: 'package-1',
    startDate: now,
    endDate: source.endDate,
    remainingSessions: 4,
    remainingDuration: 30,
    acquisitionType: MembershipAcquisitionType.TRANSFER,
  }
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: source.id }]),
    staff: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides && 'admin' in overrides
            ? overrides.admin
            : { id: 'admin-1' },
        ),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(
        overrides?.recipient ?? {
          id: 'user-target',
          name: 'Andi',
          banned: false,
        },
      ),
    },
    membershipUser: {
      findUnique: vi.fn().mockResolvedValue(overrides?.source ?? source),
      updateMany: vi.fn().mockResolvedValue({
        count: overrides?.claimCount ?? 1,
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ remainingSessions: 6 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue(destination),
    },
    membershipTransfer: {
      create: vi.fn().mockResolvedValue({
        id: 'transfer-1',
        sourceMembershipUserId: source.id,
        destinationMembershipUserId: destination.id,
        transferredHours: 4,
      }),
    },
    notification: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  } as unknown as Prisma.TransactionClient
}

describe('membership balance transfer', () => {
  it('atomically creates a separate audited transfer entitlement', async () => {
    const tx = createTx()

    const result = await transferMembershipBalance(tx, {
      sourceMembershipUserId: source.id,
      toUserId: 'user-target',
      hours: 4,
      reason: 'Persetujuan manajemen',
      adminId: 'admin-1',
      now,
    })

    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.membershipUser.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: source.id,
        remainingSessions: { gte: 4 },
        acquisitionType: MembershipAcquisitionType.PURCHASE,
      }),
      data: { remainingSessions: { decrement: 4 } },
    })
    expect(tx.membershipUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-target',
        membershipId: source.membershipId,
        remainingSessions: 4,
        endDate: source.endDate,
        acquisitionType: MembershipAcquisitionType.TRANSFER,
      }),
    })
    expect(tx.membershipTransfer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceMembershipUserId: source.id,
        destinationMembershipUserId: 'membership-destination',
        fromUserId: source.userId,
        toUserId: 'user-target',
        transferredHours: 4,
        transferredByAdminId: 'admin-1',
      }),
    })
    expect(tx.notification.createMany).toHaveBeenCalledOnce()
    expect(result.sourceMembership.remainingSessions).toBe(6)
  })

  it('rejects retransferring balance received from another member', async () => {
    const tx = createTx({
      source: {
        ...source,
        acquisitionType: MembershipAcquisitionType.TRANSFER,
      },
    })

    await expect(
      transferMembershipBalance(tx, {
        sourceMembershipUserId: source.id,
        toUserId: 'user-target',
        hours: 1,
        reason: 'Transfer ulang',
        adminId: 'admin-1',
        now,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a stale or simultaneous balance claim', async () => {
    const tx = createTx({ claimCount: 0 })

    await expect(
      transferMembershipBalance(tx, {
        sourceMembershipUserId: source.id,
        toUserId: 'user-target',
        hours: 4,
        reason: 'Persetujuan manajemen',
        adminId: 'admin-1',
        now,
      }),
    ).rejects.toThrow('Saldo berubah saat transfer diproses')
    expect(tx.membershipUser.create).not.toHaveBeenCalled()
  })

  it('rejects an inactive or non-super-admin actor', async () => {
    const tx = createTx({ admin: null })

    await expect(
      transferMembershipBalance(tx, {
        sourceMembershipUserId: source.id,
        toUserId: 'user-target',
        hours: 1,
        reason: 'Tidak berwenang',
        adminId: 'manager-1',
        now,
      }),
    ).rejects.toThrow('Hanya Super Admin aktif')
    expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a refunded source membership', async () => {
    const tx = createTx({
      source: {
        ...source,
        invoice: {
          status: PaymentStatus.PAID,
          payment: {
            meta: {
              refund: {
                type: 'PARTIAL',
                amount: 100_000,
                reason: 'Refund sebelumnya',
                status: 'COMPLETED',
                refundedAt: now.toISOString(),
              },
            },
          },
        },
      },
    })

    await expect(
      transferMembershipBalance(tx, {
        sourceMembershipUserId: source.id,
        toUserId: 'user-target',
        hours: 1,
        reason: 'Tidak valid',
        adminId: 'admin-1',
        now,
      }),
    ).rejects.toThrow('sudah di-refund')
  })

  it('rejects transfer to the same member or a banned recipient', async () => {
    const sameUserTx = createTx({
      recipient: { id: source.userId, name: 'Budi', banned: false },
    })
    await expect(
      transferMembershipBalance(sameUserTx, {
        sourceMembershipUserId: source.id,
        toUserId: source.userId,
        hours: 1,
        reason: 'Tidak valid',
        adminId: 'admin-1',
        now,
      }),
    ).rejects.toThrow('pemilik yang sama')

    const bannedUserTx = createTx({
      recipient: { id: 'user-target', name: 'Andi', banned: true },
    })
    await expect(
      transferMembershipBalance(bannedUserTx, {
        sourceMembershipUserId: source.id,
        toUserId: 'user-target',
        hours: 1,
        reason: 'Tidak valid',
        adminId: 'admin-1',
        now,
      }),
    ).rejects.toThrow('sedang diblokir')
  })
})
