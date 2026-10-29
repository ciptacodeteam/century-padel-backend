import { BadRequestException, NotFoundException } from '@/exceptions'
import { Prisma, Role } from '@prisma/client'
import { fundedMembershipWhere } from './membership-entitlement.service'
import { getCompletedRefund } from './refund.service'

export async function grantMembershipComplimentary(
  tx: Prisma.TransactionClient,
  input: {
    membershipUserId: string
    hours: number
    reason: string
    requestId: string
    adminId: string
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  const reason = input.reason.trim()
  if (
    !Number.isSafeInteger(input.hours) ||
    input.hours < 1 ||
    input.hours > 10000 ||
    reason.length < 3 ||
    reason.length > 500 ||
    !/^[0-9a-f-]{36}$/i.test(input.requestId)
  ) {
    throw new BadRequestException(
      'Jumlah kuota, alasan, atau ID permintaan tidak valid',
    )
  }
  const admin = await tx.staff.findFirst({
    where: { id: input.adminId, role: Role.ADMIN, isActive: true },
    select: { id: true },
  })
  if (!admin)
    throw new BadRequestException(
      'Hanya Super Admin aktif yang dapat menambah kuota complimentary',
    )

  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM membership_users WHERE id = ${input.membershipUserId} FOR NO KEY UPDATE`,
  )
  const previous = await tx.membershipComplimentaryGrant.findUnique({
    where: { requestId: input.requestId },
  })
  if (previous) {
    if (
      previous.membershipUserId !== input.membershipUserId ||
      previous.adminId !== input.adminId ||
      previous.hours !== input.hours ||
      previous.reason !== reason
    ) {
      throw new BadRequestException(
        'ID permintaan sudah digunakan untuk pemberian kuota lain',
      )
    }
    return previous
  }
  const membership = await tx.membershipUser.findFirst({
    where: { id: input.membershipUserId, ...fundedMembershipWhere() },
    include: {
      user: { select: { banned: true } },
      invoice: { include: { payment: true } },
    },
  })
  if (!membership)
    throw new NotFoundException('Membership yang telah lunas tidak ditemukan')
  // A depleted balance may be flagged expired; the actual date is authoritative.
  if (
    membership.user.banned ||
    membership.isSuspended ||
    membership.endDate <= now ||
    (membership.isExpired && membership.remainingSessions > 0) ||
    getCompletedRefund(membership.invoice?.payment?.meta)
  ) {
    throw new BadRequestException(
      'Membership diblokir, ditangguhkan, sudah berakhir, atau telah direfund',
    )
  }
  if (
    membership.remainingSessions + input.hours > 2_147_483_647 ||
    membership.totalComplimentarySessions + input.hours > 2_147_483_647
  )
    throw new BadRequestException('Batas saldo membership terlampaui')
  const grant = await tx.membershipComplimentaryGrant.create({
    data: {
      requestId: input.requestId,
      membershipUserId: membership.id,
      hours: input.hours,
      reason,
      adminId: admin.id,
    },
  })
  await tx.membershipUser.update({
    where: { id: membership.id },
    data: {
      remainingSessions: { increment: input.hours },
      remainingComplimentarySessions: { increment: input.hours },
      totalComplimentarySessions: { increment: input.hours },
      isExpired: false,
    },
  })
  return grant
}

/** Called after details are persisted, in the checkout transaction. The lock
 * keeps the complimentary split consistent with simultaneous bookings/grants. */
export async function consumeMembershipHours(
  tx: Prisma.TransactionClient,
  membershipUserId: string,
  bookingId: string,
  hours: number,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM membership_users WHERE id = ${membershipUserId} FOR NO KEY UPDATE`,
  )
  const now = new Date()
  const membership = await tx.membershipUser.findFirst({
    where: {
      id: membershipUserId,
      isExpired: false,
      isSuspended: false,
      startDate: { lte: now },
      endDate: { gt: now },
      remainingSessions: { gte: hours },
      ...fundedMembershipWhere(),
    },
  })
  if (!membership)
    throw new BadRequestException(
      'Saldo atau status membership berubah. Silakan coba lagi.',
    )
  let complimentary = Math.min(hours, membership.remainingComplimentarySessions)
  const consumedComplimentary = complimentary
  const details = await tx.bookingDetail.findMany({
    where: { bookingId, membershipUserId, cancelledAt: null },
    include: { slot: true },
    orderBy: { id: 'asc' },
  })
  let detailHours = 0
  for (const detail of details) {
    const duration = Math.max(
      0,
      Math.ceil(
        (detail.slot.endAt.getTime() - detail.slot.startAt.getTime()) /
          3_600_000,
      ),
    )
    detailHours += duration
    const used = Math.min(duration, complimentary)
    complimentary -= used
    await tx.bookingDetail.update({
      where: { id: detail.id },
      data: { complimentaryMembershipHours: used },
    })
  }
  if (detailHours !== hours)
    throw new BadRequestException('Alokasi kuota booking tidak sesuai')
  return tx.membershipUser.update({
    where: { id: membershipUserId },
    data: {
      remainingSessions: { decrement: hours },
      remainingComplimentarySessions: { decrement: consumedComplimentary },
      isExpired: membership.remainingSessions === hours,
    },
  })
}
