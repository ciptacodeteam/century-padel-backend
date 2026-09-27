import { db } from '@/lib/prisma'
import {
  NotificationAudience,
  NotificationType,
  PaymentStatus,
  type Prisma,
} from '@prisma/client'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'

dayjs.extend(utc)

type BookingCancellationNotificationParams = {
  userId: string
  bookingId: string
  invoiceNumber?: string | null
  reason: string
  restoredMembershipHours: number
  courtSlots: Array<{
    courtName: string
    startAt: Date
    endAt: Date
  }>
}

export async function createBookingCancellationNotification(
  tx: Prisma.TransactionClient,
  params: BookingCancellationNotificationParams,
) {
  const firstSlot = params.courtSlots[0]
  const additionalSlotCount = Math.max(0, params.courtSlots.length - 1)
  const scheduleSummary = firstSlot
    ? `${firstSlot.courtName}, ${dayjs.utc(firstSlot.startAt).format('DD/MM/YYYY HH:mm')}–${dayjs.utc(firstSlot.endAt).format('HH:mm')}${additionalSlotCount > 0 ? ` dan ${additionalSlotCount} slot lainnya` : ''}`
    : 'Booking lapangan'

  return tx.notification.create({
    data: {
      userId: params.userId,
      audience: NotificationAudience.USER,
      type: NotificationType.ADMIN_PUSH,
      title: 'Booking Lapangan Dibatalkan',
      message: `${scheduleSummary} telah dibatalkan.`,
      data: {
        event: 'BOOKING_CANCELLED',
        bookingId: params.bookingId,
        invoiceNumber: params.invoiceNumber ?? null,
        reason: params.reason,
        restoredMembershipHours: params.restoredMembershipHours,
        courtSlots: params.courtSlots.map((slot) => ({
          courtName: slot.courtName,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
        })),
      },
    },
  })
}

export async function createBookingCancellationNotificationForBooking(
  tx: Prisma.TransactionClient,
  params: {
    bookingId: string
    invoiceNumber?: string | null
    reason: string
    restoredMembershipHours: number
  },
) {
  const existingNotification = await tx.notification.findFirst({
    where: {
      AND: [
        { data: { path: ['event'], equals: 'BOOKING_CANCELLED' } },
        { data: { path: ['bookingId'], equals: params.bookingId } },
      ],
    },
    select: { id: true },
  })
  if (existingNotification) return existingNotification

  const booking = await tx.booking.findUnique({
    where: { id: params.bookingId },
    select: {
      userId: true,
      details: {
        select: {
          court: { select: { name: true } },
          slot: { select: { startAt: true, endAt: true } },
        },
      },
    },
  })
  if (!booking) return null

  return createBookingCancellationNotification(tx, {
    userId: booking.userId,
    bookingId: params.bookingId,
    invoiceNumber: params.invoiceNumber,
    reason: params.reason,
    restoredMembershipHours: params.restoredMembershipHours,
    courtSlots: booking.details.map((detail) => ({
      courtName: detail.court?.name || 'Lapangan',
      startAt: detail.slot.startAt,
      endAt: detail.slot.endAt,
    })),
  })
}

export interface CreateNotificationInput {
  userId?: string
  audience?: NotificationAudience
  type: NotificationType
  title: string
  message?: string
  data?: Record<string, any>
}

export const notificationService = {
  async create(input: CreateNotificationInput) {
    const {
      userId,
      audience = NotificationAudience.USER,
      type,
      title,
      message,
      data,
    } = input
    return db.notification.create({
      data: {
        userId: userId || null,
        audience,
        type,
        title,
        message,
        data: data ? (data as any) : undefined,
      },
    })
  },

  async listForUser(userId: string, take = 50, cursor?: string) {
    return db.notification.findMany({
      where: {
        OR: [
          { audience: NotificationAudience.ALL },
          { audience: NotificationAudience.USER, userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async listForAdmin(take = 50, cursor?: string) {
    return db.notification.findMany({
      where: {
        OR: [
          { audience: NotificationAudience.ADMIN },
          { audience: NotificationAudience.ALL },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async listForAdminUser(adminId: string, take = 50, cursor?: string) {
    return db.notification.findMany({
      where: {
        OR: [
          { audience: NotificationAudience.ALL },
          { audience: NotificationAudience.ADMIN, userId: null }, // broadcast to all admins
          { audience: NotificationAudience.ADMIN, userId: adminId }, // targeted to this admin
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async markRead(id: string, userId?: string) {
    // Ensure the notification belongs to the user (if userId provided) unless it's broadcast
    const notif = await db.notification.findUnique({ where: { id } })
    if (!notif) throw new Error('Notification not found')
    if (userId && notif.userId && notif.userId !== userId) {
      throw new Error('Forbidden to mark this notification')
    }
    return db.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    })
  },

  async createBookingAdminNotification(
    bookingId: string,
    invoiceNumber?: string,
  ) {
    return this.create({
      audience: NotificationAudience.ADMIN,
      type: NotificationType.BOOKING_CREATED,
      title: 'New Booking Created',
      message: 'A user has created a new booking.',
      data: { bookingId, invoiceNumber },
    })
  },

  async createPaymentSuccessNotifications(params: {
    invoiceId: string
    invoiceNumber: string
    userId: string
    total: number
    paymentStatus: PaymentStatus
    bookingId?: string
    membershipUserId?: string
    classBookingId?: string
  }) {
    const {
      invoiceId,
      invoiceNumber,
      userId,
      total,
      paymentStatus,
      bookingId,
      membershipUserId,
      classBookingId,
    } = params
    if (paymentStatus !== PaymentStatus.PAID) return

    // User notification
    await this.create({
      userId,
      audience: NotificationAudience.USER,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Payment Successful',
      message: `Your payment for invoice ${invoiceNumber} was successful`,
      data: {
        invoiceId,
        invoiceNumber,
        total,
        bookingId,
        membershipUserId,
        classBookingId,
      },
    })

    // Admin notification
    await this.create({
      audience: NotificationAudience.ADMIN,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Payment Captured',
      message: `Invoice ${invoiceNumber} was paid`,
      data: { invoiceId, invoiceNumber, total, userId },
    })
  },

  markAllReadForUser: async (userId: string) => {
    return db.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
  },

  markAllReadForAdmin: async (adminId: string) => {
    return db.notification.updateMany({
      where: {
        OR: [
          { audience: NotificationAudience.ALL },
          { audience: NotificationAudience.ADMIN, userId: null },
          { audience: NotificationAudience.ADMIN, userId: adminId },
        ],
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
  },
}
