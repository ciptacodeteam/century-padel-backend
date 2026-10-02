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
    Prisma.sql`SELECT id FROM membership_users WHERE id = ${input.sourceMembershipUserId} FOR UPDATE`,
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
  if (input.hours > source.remainingSessions) {
    throw new BadRequestException('Saldo membership tidak mencukupi')
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
