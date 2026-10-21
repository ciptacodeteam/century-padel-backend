import { BadRequestException, NotFoundException } from '@/exceptions'
import {
  MembershipAcquisitionType,
  NotificationAudience,
  NotificationType,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client'
import { getCompletedRefund } from './refund.service'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export type TransferMembershipBalanceInput = {
  sourceMembershipUserId: string
  toUserId: string
  hours: number
  reason: string
  adminId: string
  now?: Date
}

export async function transferMembershipBalance(
  tx: Prisma.TransactionClient,
  input: TransferMembershipBalanceInput,
) {
  const now = input.now ?? new Date()

  // Serialize every balance-changing operation for this membership. This also
  // prevents two simultaneous admin requests from spending the same hours.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM membership_users WHERE id = ${input.sourceMembershipUserId} FOR NO KEY UPDATE`,
  )

  const [admin, source, recipient] = await Promise.all([
    tx.staff.findFirst({
      where: { id: input.adminId, role: Role.ADMIN, isActive: true },
      select: { id: true },
    }),
    tx.membershipUser.findUnique({
      where: { id: input.sourceMembershipUserId },
      include: {
        user: { select: { id: true, name: true } },
        membership: { select: { id: true, name: true, type: true } },
        invoice: { include: { payment: true } },
      },
    }),
    tx.user.findUnique({
      where: { id: input.toUserId },
      select: { id: true, name: true, banned: true },
    }),
  ])

  if (!admin) {
    throw new BadRequestException(
      'Hanya Super Admin aktif yang dapat mentransfer saldo membership',
    )
  }
  if (!source) throw new NotFoundException('Membership asal tidak ditemukan')
  if (!recipient) throw new NotFoundException('Member penerima tidak ditemukan')
  if (source.userId === recipient.id) {
    throw new BadRequestException(
      'Saldo tidak dapat ditransfer ke pemilik yang sama',
    )
  }
  if (recipient.banned) {
    throw new BadRequestException('Member penerima sedang diblokir')
  }
  if (source.acquisitionType !== MembershipAcquisitionType.PURCHASE) {
    throw new BadRequestException(
      'Saldo hasil transfer tidak dapat ditransfer kembali',
    )
  }
  if (!source.invoice || source.invoice.status !== PaymentStatus.PAID) {
    throw new BadRequestException(
      'Membership asal bukan pembelian yang sudah lunas',
    )
  }
  if (getCompletedRefund(source.invoice.payment?.meta)) {
    throw new BadRequestException(
      'Membership yang sudah di-refund tidak dapat ditransfer',
    )
  }
  if (
    source.isExpired ||
    source.isSuspended ||
    source.startDate > now ||
    source.endDate <= now
  ) {
    throw new BadRequestException('Membership asal sedang tidak aktif')
  }
  if (!Number.isInteger(input.hours) || input.hours <= 0) {
    throw new BadRequestException(
      'Jumlah transfer harus berupa jam bulat positif',
    )
  }
  if (
    input.hours >
    source.remainingSessions - (source.remainingComplimentarySessions ?? 0)
  ) {
    throw new BadRequestException(
      'Saldo berbayar tidak mencukupi. Kuota complimentary tidak dapat ditransfer.',
    )
  }

  const balanceClaim = await tx.membershipUser.updateMany({
    where: {
      id: source.id,
      acquisitionType: MembershipAcquisitionType.PURCHASE,
      isExpired: false,
      isSuspended: false,
      startDate: { lte: now },
      endDate: { gt: now },
      remainingSessions: { gte: input.hours },
      invoice: { is: { status: PaymentStatus.PAID } },
    },
    data: { remainingSessions: { decrement: input.hours } },
  })
  if (balanceClaim.count !== 1) {
    throw new BadRequestException(
      'Saldo berubah saat transfer diproses. Silakan muat ulang dan coba lagi.',
    )
  }

  const updatedSource = await tx.membershipUser.findUniqueOrThrow({
    where: { id: source.id },
    select: { remainingSessions: true },
  })
  if (updatedSource.remainingSessions === 0) {
    await tx.membershipUser.update({
      where: { id: source.id },
      data: { isExpired: true },
    })
  }

  const remainingDuration = Math.max(
    1,
    Math.ceil(
      (source.endDate.getTime() - now.getTime()) / MILLISECONDS_PER_DAY,
    ),
  )
  const destination = await tx.membershipUser.create({
    data: {
      userId: recipient.id,
      membershipId: source.membershipId,
      startDate: now,
      endDate: source.endDate,
      remainingSessions: input.hours,
      remainingDuration,
      acquisitionType: MembershipAcquisitionType.TRANSFER,
    },
  })

  const transfer = await tx.membershipTransfer.create({
    data: {
      sourceMembershipUserId: source.id,
      destinationMembershipUserId: destination.id,
      fromUserId: source.userId,
      toUserId: recipient.id,
      transferredHours: input.hours,
      reason: input.reason,
      transferredByAdminId: admin.id,
    },
  })

  await tx.notification.createMany({
    data: [
      {
        userId: source.userId,
        audience: NotificationAudience.USER,
        type: NotificationType.ADMIN_PUSH,
        title: 'Saldo Membership Ditransfer',
        message: `${input.hours} jam ${source.membership.name} telah ditransfer kepada ${recipient.name}.`,
        data: {
          event: 'MEMBERSHIP_BALANCE_TRANSFERRED_OUT',
          transferId: transfer.id,
          membershipUserId: source.id,
          hours: input.hours,
          recipientName: recipient.name,
        },
      },
      {
        userId: recipient.id,
        audience: NotificationAudience.USER,
        type: NotificationType.ADMIN_PUSH,
        title: 'Saldo Membership Diterima',
        message: `Anda menerima ${input.hours} jam ${source.membership.name}. Berlaku sampai ${source.endDate.toLocaleDateString('id-ID')}.`,
        data: {
          event: 'MEMBERSHIP_BALANCE_TRANSFERRED_IN',
          transferId: transfer.id,
          membershipUserId: destination.id,
          hours: input.hours,
          sourceName: source.user.name,
        },
      },
    ],
  })

  return {
    transfer,
    sourceMembership: {
      id: source.id,
      remainingSessions: updatedSource.remainingSessions,
    },
    destinationMembership: destination,
    fromUser: source.user,
    toUser: { id: recipient.id, name: recipient.name },
    membership: source.membership,
  }
}

export async function cancelMembershipTransfer(
  tx: Prisma.TransactionClient,
  input: {
    transferId: string
    membershipUserId: string
    reason: string
    adminId: string
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  const reason = input.reason.trim()
  if (reason.length < 3 || reason.length > 500) {
    throw new BadRequestException(
      'Alasan pembatalan wajib diisi (3–500 karakter)',
    )
  }
  const admin = await tx.staff.findFirst({
    where: { id: input.adminId, role: Role.ADMIN, isActive: true },
    select: { id: true },
  })
  if (!admin)
    throw new BadRequestException(
      'Hanya Super Admin aktif yang dapat membatalkan transfer',
    )

  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM membership_transfers WHERE id = ${input.transferId} FOR UPDATE`,
  )
  const transfer = await tx.membershipTransfer.findUnique({
    where: { id: input.transferId },
  })
  if (
    !transfer ||
    ![
      transfer.sourceMembershipUserId,
      transfer.destinationMembershipUserId,
    ].includes(input.membershipUserId)
  ) {
    throw new NotFoundException('Transfer membership tidak ditemukan')
  }
  if (transfer.cancelledAt)
    throw new BadRequestException('Transfer sudah dibatalkan')

  // Lock the source first, matching the order used by a new transfer. Checkout
  // uses conditional deductions, so a waiting checkout cannot spend revoked hours.
  for (const id of [
    transfer.sourceMembershipUserId,
    transfer.destinationMembershipUserId,
  ]) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM membership_users WHERE id = ${id} FOR NO KEY UPDATE`,
    )
  }
  const source = await tx.membershipUser.findUniqueOrThrow({
    where: { id: transfer.sourceMembershipUserId },
    include: { invoice: { include: { payment: true } } },
  })
  const destination = await tx.membershipUser.findUniqueOrThrow({
    where: { id: transfer.destinationMembershipUserId },
  })
  if (
    !source.invoice ||
    source.invoice.status !== PaymentStatus.PAID ||
    getCompletedRefund(source.invoice.payment?.meta)
  ) {
    throw new BadRequestException(
      'Membership asal sudah tidak memenuhi syarat pengembalian saldo',
    )
  }
  if (destination.totalComplimentarySessions > 0) {
    throw new BadRequestException(
      'Transfer yang telah menerima complimentary tidak dapat dibatalkan',
    )
  }
  if (destination.remainingSessions !== transfer.transferredHours) {
    throw new BadRequestException(
      'Transfer tidak dapat dibatalkan karena jam sudah digunakan atau saldo berubah',
    )
  }
  const booking = await tx.bookingDetail.findFirst({
    where: {
      membershipUserId: destination.id,
      cancelledAt: null,
      booking: { status: { not: 'CANCELLED' } },
    },
    select: { id: true },
  })
  if (booking)
    throw new BadRequestException(
      'Transfer masih terkait booking aktif atau jam yang sudah digunakan. Selesaikan booking terkait terlebih dahulu.',
    )

  const revoked = await tx.membershipUser.updateMany({
    where: { id: destination.id, remainingSessions: transfer.transferredHours },
    data: { remainingSessions: 0, isExpired: true },
  })
  if (revoked.count !== 1)
    throw new BadRequestException(
      'Saldo berubah saat pembatalan diproses. Silakan muat ulang.',
    )
  await tx.membershipUser.update({
    where: { id: source.id },
    data: {
      remainingSessions: { increment: transfer.transferredHours },
      isExpired: source.endDate <= now,
    },
  })
  const cancelled = await tx.membershipTransfer.update({
    where: { id: transfer.id },
    data: {
      cancelledAt: now,
      cancellationReason: reason,
      cancelledByAdminId: admin.id,
    },
  })
  await tx.notification.createMany({
    data: [transfer.fromUserId, transfer.toUserId].map((userId) => ({
      userId,
      audience: NotificationAudience.USER,
      type: NotificationType.ADMIN_PUSH,
      title: 'Transfer Membership Dibatalkan',
      message: `Transfer ${transfer.transferredHours} jam dibatalkan. Jam dikembalikan ke pemilik asal. Alasan: ${reason}`,
      data: {
        event: 'MEMBERSHIP_TRANSFER_CANCELLED',
        transferId: transfer.id,
        hours: transfer.transferredHours,
      },
    })),
  })
  return cancelled
}
