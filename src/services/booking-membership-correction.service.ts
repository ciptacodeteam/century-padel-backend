import { BadRequestException, NotFoundException } from '@/exceptions'
import { PaymentStatus, Prisma, Role } from '@prisma/client'
import { canMembershipUseSlots } from './membership-eligibility.service'
import { calculateCourtHours } from './membership-hours.service'
import { getCompletedRefund } from './refund.service'

async function correctionBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      membershipCorrection: true,
      details: { include: { slot: true } },
      invoice: { include: { payment: true } },
    },
  })
  if (!booking) throw new NotFoundException('Booking tidak ditemukan')
  if (
    booking.status !== 'CONFIRMED' ||
    booking.membershipCorrection ||
    booking.invoice?.status !== PaymentStatus.PAID ||
    (booking.invoice.payment && booking.invoice.payment.status !== 'PAID') ||
    getCompletedRefund(booking.invoice.payment?.meta) ||
    booking.details.some((d) => d.cancelledAt || d.refundAmount > 0)
  )
    throw new BadRequestException(
      'Booking sudah dikoreksi, dibatalkan, belum lunas, atau direfund',
    )
  if (
    booking.invoice.subtotal !== booking.totalPrice ||
    (booking.invoice.payment &&
      booking.invoice.payment.amount !== booking.invoice.total)
  ) {
    throw new BadRequestException(
      'Total booking dan invoice tidak konsisten; periksa manual',
    )
  }
  const details = booking.details.filter(
    (d) =>
      d.complimentaryMembershipHours > 0 || d.complimentaryCreditMinutes > 0,
  )
  if (!details.length)
    throw new BadRequestException(
      'Booking tidak memiliki pemakaian complimentary',
    )
  for (const d of details) {
    const minutes = (d.slot.endAt.getTime() - d.slot.startAt.getTime()) / 60_000
    const hours = calculateCourtHours([d.slot])
    // Mixed funding inside one detail needs a separate split, never silently move paid hours.
    if (
      minutes <= 0 ||
      d.membershipHoursRestored ||
      (d.complimentaryCreditMinutes > 0
        ? d.complimentaryCreditMinutes !== minutes ||
          !!d.membershipUserId ||
          d.complimentaryMembershipHours > 0
        : !d.membershipUserId || d.complimentaryMembershipHours !== hours)
    )
      throw new BadRequestException(
        'Detail dengan kuota campuran atau tidak konsisten memerlukan pemeriksaan manual',
      )
  }
  return {
    booking,
    details,
    hours: calculateCourtHours(details.map((d) => d.slot)),
  }
}

function eligibleTarget(
  target: Prisma.MembershipUserGetPayload<{
    include: {
      membership: true
      user: true
      invoice: { include: { payment: true } }
    }
  }>,
  userId: string,
  slots: Array<{ startAt: Date; endAt: Date }>,
  hours: number,
  now: Date,
) {
  // Slot values are local wall-clock UTC; membership dates are actual WIB instants.
  const slotInstant = (date: Date) => date.getTime() - 7 * 3_600_000
  return (
    target.userId === userId &&
    !target.user.banned &&
    target.acquisitionType === 'PURCHASE' &&
    target.invoice?.status === 'PAID' &&
    (!target.invoice.payment || target.invoice.payment.status === 'PAID') &&
    !getCompletedRefund(target.invoice.payment?.meta) &&
    !target.isSuspended &&
    !target.isExpired &&
    target.startDate <= now &&
    target.endDate > now &&
    target.remainingSessions - target.remainingComplimentarySessions >= hours &&
    canMembershipUseSlots(
      target.membership.type,
      slots.flatMap((slot) => {
        const segments: Array<{ startAt: Date }> = []
        for (
          let time = slot.startAt.getTime();
          time < slot.endAt.getTime();
          time += 3_600_000
        ) {
          segments.push({ startAt: new Date(time) })
        }
        segments.push({ startAt: new Date(slot.endAt.getTime() - 1) })
        return segments
      }),
    ) &&
    slots.every(
      (slot) =>
        slotInstant(slot.startAt) >= target.startDate.getTime() &&
        slotInstant(slot.endAt) <= target.endDate.getTime(),
    )
  )
}

const targetInclude = {
  membership: true,
  user: true,
  invoice: { include: { payment: true } },
} as const

export async function getBookingMembershipCorrectionOptions(
  tx: Prisma.TransactionClient,
  bookingId: string,
) {
  const { booking, details, hours } = await correctionBooking(tx, bookingId)
  const targets = await tx.membershipUser.findMany({
    where: {
      userId: booking.userId,
      acquisitionType: 'PURCHASE',
      isSuspended: false,
      isExpired: false,
    },
    include: targetInclude,
    orderBy: { endDate: 'asc' },
  })
  return {
    hours,
    memberships: targets
      .filter((target) =>
        eligibleTarget(
          target,
          booking.userId,
          details.map((d) => d.slot),
          hours,
          new Date(),
        ),
      )
      .map((target) => ({
        id: target.id,
        name: target.membership.name,
        invoiceNumber: target.invoice!.number,
        paidHours:
          target.remainingSessions - target.remainingComplimentarySessions,
        remainingHours: target.remainingSessions,
        endDate: target.endDate,
      })),
  }
}

// Must run in a serializable transaction: any conflicting cancellation/checkout rolls back all changes.
export async function correctBookingToPaidMembership(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string
    membershipUserId: string
    adminId: string
    reason: string
  },
) {
  const reason = input.reason.trim()
  if (reason.length < 5 || reason.length > 500)
    throw new BadRequestException('Alasan wajib 5–500 karakter')
  const admin = await tx.staff.findFirst({
    where: { id: input.adminId, role: Role.ADMIN, isActive: true },
    select: { id: true },
  })
  if (!admin)
    throw new BadRequestException(
      'Hanya Super Admin aktif yang dapat mengoreksi kuota',
    )
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM bookings WHERE id = ${input.bookingId} FOR UPDATE`,
  )
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM booking_details WHERE "bookingId" = ${input.bookingId} ORDER BY id FOR UPDATE`,
  )
  const { booking, details, hours } = await correctionBooking(
    tx,
    input.bookingId,
  )
  const ids = [
    ...new Set([
      input.membershipUserId,
      ...details
        .map((d) => d.membershipUserId)
        .filter((id): id is string => !!id),
    ]),
  ].sort()
  for (const id of ids)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM membership_users WHERE id = ${id} FOR NO KEY UPDATE`,
    )
  for (const sourceId of ids.filter((id) =>
    details.some((d) => d.membershipUserId === id),
  )) {
    const source = await tx.membershipUser.findUnique({
      where: { id: sourceId },
    })
    const used = details
      .filter((d) => d.membershipUserId === sourceId)
      .reduce((sum, d) => sum + d.complimentaryMembershipHours, 0)
    if (
      !source ||
      source.userId !== booking.userId ||
      source.totalComplimentarySessions < used
    ) {
      throw new BadRequestException('Sumber kuota membership tidak konsisten')
    }
  }
  const target = await tx.membershipUser.findUnique({
    where: { id: input.membershipUserId },
    include: targetInclude,
  })
  if (
    !target ||
    !eligibleTarget(
      target,
      booking.userId,
      details.map((d) => d.slot),
      hours,
      new Date(),
    )
  ) {
    throw new BadRequestException(
      'Paket harus milik pelanggan, lunas, aktif, sesuai jadwal, dan memiliki saldo berbayar yang cukup',
    )
  }
  const sources = details.map((d) => ({
    detailId: d.id,
    membershipUserId: d.membershipUserId,
    complimentaryMembershipHours: d.complimentaryMembershipHours,
    complimentaryCreditMinutes: d.complimentaryCreditMinutes,
  }))
  const creditMinutes = details.reduce(
    (sum, d) => sum + d.complimentaryCreditMinutes,
    0,
  )
  if (creditMinutes > 0) {
    if (
      booking.complimentaryCreditRestoredAt ||
      booking.complimentaryCreditMinutes !== creditMinutes
    ) {
      throw new BadRequestException(
        'Saldo complimentary booking tidak konsisten',
      )
    }
    const transactions = await tx.complimentaryCreditTransaction.findMany({
      where: { bookingId: booking.id, type: { in: ['REDEEM', 'REFUND'] } },
      include: { credit: true },
    })
    const balances = new Map<string, number>()
    for (const t of transactions) {
      if (t.credit.userId !== booking.userId)
        throw new BadRequestException(
          'Pemilik saldo complimentary tidak sesuai',
        )
      balances.set(
        t.creditId,
        (balances.get(t.creditId) ?? 0) +
          (t.type === 'REDEEM' ? t.minutes : -t.minutes),
      )
    }
    if (
      [...balances.values()].some((n) => n < 0) ||
      [...balances.values()].reduce((a, b) => a + b, 0) !== creditMinutes
    ) {
      throw new BadRequestException('Riwayat saldo complimentary tidak sesuai')
    }
    // Refund + immediate revoke closes the old redemption without resurrecting free balance.
    for (const [creditId, minutes] of balances) {
      if (!minutes) continue
      for (const type of ['REFUND', 'REVOKE'] as const)
        await tx.complimentaryCreditTransaction.create({
          data: {
            creditId,
            bookingId: booking.id,
            type,
            minutes,
            staffId: admin.id,
            note: `Koreksi ke paket berbayar: ${reason}`,
          },
        })
    }
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        complimentaryCreditMinutes: 0,
        complimentaryCreditValue: 0,
        complimentaryCreditRestoredAt: new Date(),
      },
    })
  }
  // Old membership complimentary was already consumed: retire it; never restore free quota.
  await tx.membershipUser.update({
    where: { id: target.id },
    data: {
      remainingSessions: { decrement: hours },
      isExpired: target.remainingSessions === hours,
    },
  })
  const changed = await tx.bookingDetail.updateMany({
    where: {
      id: { in: details.map((d) => d.id) },
      cancelledAt: null,
      membershipHoursRestored: false,
    },
    data: {
      membershipUserId: target.id,
      complimentaryMembershipHours: 0,
      complimentaryCreditMinutes: 0,
    },
  })
  if (changed.count !== details.length)
    throw new BadRequestException(
      'Booking berubah saat dikoreksi; muat ulang dan coba lagi',
    )
  const correction = await tx.bookingMembershipCorrection.create({
    data: {
      bookingId: booking.id,
      targetMembershipUserId: target.id,
      adminId: admin.id,
      hours,
      reason,
      sources,
    },
  })
  return { ...correction, remainingHours: target.remainingSessions - hours }
}
