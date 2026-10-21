import { BadRequestException } from '@/exceptions'
import {
  MembershipAcquisitionType,
  PaymentStatus,
  Prisma,
} from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  cancelMembershipTransfer,
  transferMembershipBalance,
} from './membership-transfer.service'

const now = new Date('2026-10-02T05:00:00.000Z')
const source = {
  id: 'membership-source',
  userId: 'user-source',
  membershipId: 'package-1',
  startDate: new Date('2026-09-01T00:00:00.000Z'),
  endDate: new Date('2026-11-01T00:00:00.000Z'),
  remainingSessions: 10,
  remainingComplimentarySessions: 0,
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

function createCancellationTx(
  options: {
    admin?: boolean
    cancelled?: boolean
    remaining?: number
    booking?: boolean
    claimCount?: number
    expiredSource?: boolean
    unrelated?: boolean
    refunded?: boolean
  } = {},
) {
  const transfer = {
    id: 'transfer-1',
    sourceMembershipUserId: source.id,
    destinationMembershipUserId: 'membership-destination',
    fromUserId: source.userId,
    toUserId: 'user-target',
    transferredHours: 4,
    cancelledAt: options.cancelled ? now : null,
  }
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    staff: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.admin === false ? null : { id: 'admin-1' }),
    },
    membershipTransfer: {
      findUnique: vi
        .fn()
        .mockResolvedValue(options.unrelated ? null : transfer),
      update: vi.fn().mockResolvedValue({ ...transfer, cancelledAt: now }),
    },
    membershipUser: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValueOnce({
          ...source,
          endDate: options.expiredSource
            ? new Date('2026-09-01')
            : source.endDate,
          invoice: options.refunded
            ? { ...source.invoice, status: PaymentStatus.REFUNDED }
            : source.invoice,
        })
        .mockResolvedValueOnce({
          id: 'membership-destination',
          remainingSessions: options.remaining ?? 4,
        }),
      updateMany: vi.fn().mockResolvedValue({ count: options.claimCount ?? 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    bookingDetail: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.booking ? { id: 'booking-detail' } : null),
    },
    notification: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  } as unknown as Prisma.TransactionClient
}

const cancellationInput = {
  transferId: 'transfer-1',
  membershipUserId: source.id,
  reason: 'Salah memilih penerima',
  adminId: 'admin-1',
  now,
}

describe('membership transfer cancellation', () => {
  it('revokes the entire entitlement, restores the source and preserves cancellation audit', async () => {
    const tx = createCancellationTx()
    await cancelMembershipTransfer(tx, cancellationInput)
    expect(tx.membershipUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'membership-destination', remainingSessions: 4 },
      data: { remainingSessions: 0, isExpired: true },
    })
    expect(tx.membershipUser.update).toHaveBeenCalledWith({
      where: { id: source.id },
      data: { remainingSessions: { increment: 4 }, isExpired: false },
    })
    expect(tx.membershipTransfer.update).toHaveBeenCalledWith({
      where: { id: 'transfer-1' },
      data: {
        cancelledAt: now,
        cancellationReason: cancellationInput.reason,
        cancelledByAdminId: 'admin-1',
      },
    })
    expect(tx.notification.createMany).toHaveBeenCalledOnce()
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3)
  })

  it('restores expired source hours without extending validity', async () => {
    const tx = createCancellationTx({ expiredSource: true })
    await cancelMembershipTransfer(tx, cancellationInput)
    expect(tx.membershipUser.update).toHaveBeenCalledWith({
      where: { id: source.id },
      data: { remainingSessions: { increment: 4 }, isExpired: true },
    })
  })

  it.each([
    [{ admin: false }, 'Hanya Super Admin aktif'],
    [{ cancelled: true }, 'sudah dibatalkan'],
    [{ remaining: 3 }, 'jam sudah digunakan'],
    [{ booking: true }, 'booking aktif'],
    [{ unrelated: true }, 'tidak ditemukan'],
    [{ refunded: true }, 'tidak memenuhi syarat'],
  ])(
    'rejects unsafe cancellation %j without changing balances',
    async (options, message) => {
      const tx = createCancellationTx(options)
      await expect(
        cancelMembershipTransfer(tx, cancellationInput),
      ).rejects.toThrow(message)
      expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
      expect(tx.membershipTransfer.update).not.toHaveBeenCalled()
    },
  )

  it('rejects transfers outside the selected membership', async () => {
    const tx = createCancellationTx()
    await expect(
      cancelMembershipTransfer(tx, {
        ...cancellationInput,
        membershipUserId: 'other',
      }),
    ).rejects.toThrow('tidak ditemukan')
    expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
  })

  it.each(['', '  ', 'a'.repeat(501)])(
    'requires a valid audit reason',
    async (reason) => {
      const tx = createCancellationTx()
      await expect(
        cancelMembershipTransfer(tx, { ...cancellationInput, reason }),
      ).rejects.toThrow('Alasan pembatalan')
      expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
    },
  )

  it('does not restore the source if conditional revocation fails', async () => {
    const tx = createCancellationTx({ claimCount: 0 })
    await expect(
      cancelMembershipTransfer(tx, cancellationInput),
    ).rejects.toThrow('Saldo berubah')
    expect(tx.membershipUser.update).not.toHaveBeenCalled()
    expect(tx.membershipTransfer.update).not.toHaveBeenCalled()
  })
})

describe('complimentary transfer restrictions', () => {
  it('cannot transfer complimentary as if it were paid balance', async () => {
    const tx = createTx({
      source: { ...source, remainingComplimentarySessions: 8 },
    })
    await expect(
      transferMembershipBalance(tx, {
        sourceMembershipUserId: source.id,
        toUserId: 'user-target',
        hours: 4,
        reason: 'Pindah saldo',
        adminId: 'admin-1',
        now,
      }),
    ).rejects.toThrow('complimentary tidak dapat ditransfer')
    expect(tx.membershipTransfer.create).not.toHaveBeenCalled()
    expect(tx.membershipUser.updateMany).not.toHaveBeenCalled()
  })
  it('allows transferring only the paid portion without modifying complimentary', async () => {
    const tx = createTx({
      source: { ...source, remainingComplimentarySessions: 6 },
    })
    await transferMembershipBalance(tx, {
      sourceMembershipUserId: source.id,
      toUserId: 'user-target',
      hours: 4,
      reason: 'Pindah saldo',
      adminId: 'admin-1',
      now,
    })
    expect(tx.membershipUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { remainingSessions: { decrement: 4 } },
      }),
    )
  })
})
