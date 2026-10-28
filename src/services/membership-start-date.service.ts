import { BadRequestException, NotFoundException } from '@/exceptions'
import {
  MembershipAcquisitionType,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client'
import { getCompletedRefund } from './refund.service'

const DAY_MS = 86_400_000

// Membership activation uses midnight in the venue's timezone, independently
// of the server timezone. Court slot wall-clock storage is a separate concern.
export function membershipStartDate(date: string, now = new Date()): Date {
  const start = new Date(`${date}T00:00:00+07:00`)
  const jakartaDate = (value: Date) =>
    new Date(value.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(start.getTime()) ||
    jakartaDate(start) !== date ||
    date < jakartaDate(now)
  ) {
    throw new BadRequestException(
      'Tanggal mulai harus hari ini atau setelahnya (WIB)',
    )
  }
  return start
}

export async function rescheduleMembershipStart(
  tx: Prisma.TransactionClient,
  input: {
    membershipUserId: string
    startDate: string
    reason: string
    adminId: string
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  const startDate = membershipStartDate(input.startDate, now)
  const reason = input.reason.trim()
  if (reason.length < 3 || reason.length > 500)
    throw new BadRequestException(
      'Alasan perubahan wajib diisi (3–500 karakter)',
    )
  const admin = await tx.staff.findFirst({
    where: { id: input.adminId, role: Role.ADMIN, isActive: true },
    select: { id: true },
  })
  if (!admin)
    throw new BadRequestException(
      'Hanya Super Admin aktif yang dapat mengatur tanggal mulai',
    )

  // Shares the booking/transfer lock: a booking that wins the lock makes this
  // request fail; one that follows must recheck the new activation date.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM membership_users WHERE id = ${input.membershipUserId} FOR NO KEY UPDATE`,
  )
  const membership = await tx.membershipUser.findUnique({
    where: { id: input.membershipUserId },
    include: {
      membership: true,
      invoice: { include: { payment: true } },
      _count: { select: { bookingDetails: true, outgoingTransfers: true } },
    },
  })
  if (!membership) throw new NotFoundException('Membership tidak ditemukan')
  if (
    membership.acquisitionType !== MembershipAcquisitionType.PURCHASE ||
    membership.invoice?.status !== PaymentStatus.PAID ||
    getCompletedRefund(membership.invoice?.payment?.meta) ||
    membership.isExpired ||
    membership.isSuspended ||
    membership.endDate <= now
  )
    throw new BadRequestException(
      'Hanya membership pembelian lunas yang belum berakhir dan tidak ditangguhkan yang dapat diubah',
    )
  if (
    membership._count.bookingDetails > 0 ||
    membership._count.outgoingTransfers > 0 ||
    membership.remainingSessions !==
      membership.membership.sessions + membership.totalComplimentarySessions ||
    membership.remainingComplimentarySessions !==
      membership.totalComplimentarySessions
  )
    throw new BadRequestException(
      'Membership sudah pernah digunakan atau ditransfer; tanggal mulai tidak dapat diubah',
    )

  // Preserve the purchased period even if the package duration was later edited.
  const durationMs =
    membership.endDate.getTime() - membership.startDate.getTime()
  const endDate = new Date(startDate.getTime() + durationMs)
  if (durationMs <= 0 || !Number.isFinite(endDate.getTime()))
    throw new BadRequestException('Durasi membership tidak valid')
  // A retry after a lost response does not create duplicate audit entries.
  if (membership.startDate.getTime() === startDate.getTime()) return membership
  await tx.membershipStartDateChange.create({
    data: {
      membershipUserId: membership.id,
      previousStartDate: membership.startDate,
      previousEndDate: membership.endDate,
      startDate,
      endDate,
      reason,
      adminId: admin.id,
    },
  })
  return tx.membershipUser.update({
    where: { id: membership.id },
    data: {
      startDate,
      endDate,
      remainingDuration: Math.ceil(durationMs / DAY_MS),
    },
  })
}
