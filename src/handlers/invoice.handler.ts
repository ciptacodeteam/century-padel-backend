import {
  cancelledMembershipData,
  cancelPendingMembershipPayment,
  expirePendingMembershipPayments,
} from '@/services/membership-payment.service'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { SearchQuerySchema, searchQuerySchema } from '@/lib/validation'
import { requireAuth } from '@/middlewares/auth'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { z } from 'zod'
import { PaymentStatus, BookingStatus } from '@prisma/client'
import xenditService from '@/services/xendit.service'
import { getFileUrl } from '@/services/upload.service'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@/exceptions'
import dayjs from 'dayjs'
import { env } from '@/env'
import { restoreMembershipHoursForBookingId } from '@/services/membership-hours.service'
import { restoreComplimentaryCreditsForBooking } from '@/services/complimentary-credit.service'
import { isVirtualAccountChannel } from '@/lib/payment-channel'
import {
  createInvoiceShareToken,
  verifyInvoiceShareToken,
} from '@/lib/invoice-share'
import { createBookingCancellationNotificationForBooking } from '@/services/notification.service'

// GET /invoices
export const getUserInvoicesHandler = factory.createHandlers(
  requireAuth,
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { issuedAt: 'desc' },
        searchableFields: ['status', 'dueDate'],
      })

      await expirePendingMembershipPayments(new Date(), { userId: user.id })
      const invoices = await db.invoice.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          userId: user.id,
        },
        select: {
          id: true,
          number: true,
          status: true,
          subtotal: true,
          processingFee: true,
          // promoCodeText: true,
          promoDiscountAmount: true,
          total: true,
          issuedAt: true,
          dueDate: true,
          paidAt: true,
          booking: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              courtNormalPrice: true,
              courtDiscountPrice: true,
              createdAt: true,
              details: {
                select: {
                  id: true,
                  membershipUserId: true,
                  complimentaryMembershipHours: true,
                  membershipUser: {
                    select: {
                      membership: { select: { name: true, type: true } },
                    },
                  },
                  court: { select: { id: true, name: true } },
                  price: true,
                  discountPrice: true,
                  slot: true,
                  createdAt: true,
                },
              },
            },
          },
          classBooking: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              class: { select: { id: true, name: true } },
            },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              membership: { select: { id: true, name: true } },
            },
          },
        },
      })

      return c.json(ok(invoices), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getUserInvoicesHandler: ${error}`)
      throw error
    }
  },
)

// GET /invoices/:id (detail)
export const getInvoiceDetailHandler = factory.createHandlers(
  zValidator('param', z.object({ id: z.string().min(1) }), validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      const { id } = c.req.valid('param') as { id: string }
      const hasValidShareToken = verifyInvoiceShareToken(
        id,
        c.req.query('share'),
      )

      if ((!user || !user.id) && !hasValidShareToken) {
        throw new UnauthorizedException()
      }

      await expirePendingMembershipPayments(new Date(), {
        invoiceNumber: id,
        ...(!hasValidShareToken ? { userId: user!.id } : {}),
      })
      const invoice: any = await db.invoice.findFirst({
        where: hasValidShareToken
          ? { number: id }
          : { number: id, userId: user!.id },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          booking: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              processingFee: true,
              courtNormalPrice: true,
              courtDiscountPrice: true,
              createdAt: true,
              details: {
                select: {
                  id: true,
                  membershipUserId: true,
                  complimentaryMembershipHours: true,
                  cancelledAt: true,
                  membershipUser: {
                    select: {
                      membership: {
                        select: {
                          name: true,
                          type: true,
                          price: true,
                          sessions: true,
                        },
                      },
                      invoice: {
                        select: {
                          subtotal: true,
                          promoDiscountAmount: true,
                          status: true,
                        },
                      },
                    },
                  },
                  price: true,
                  discountPrice: true,
                  slot: true,
                  court: { select: { id: true, name: true } },
                },
              },
              inventories: {
                select: {
                  id: true,
                  quantity: true,
                  price: true,
                  inventory: { select: { id: true, name: true } },
                },
              },
              coaches: {
                select: {
                  id: true,
                  price: true,
                  bookingCoachType: { select: { id: true, name: true } },
                  slot: {
                    include: {
                      staff: { select: { id: true, name: true, role: true } },
                    },
                  },
                },
              },
              ballboys: {
                select: {
                  id: true,
                  price: true,
                  slot: {
                    include: {
                      staff: { select: { id: true, name: true, role: true } },
                    },
                  },
                },
              },
            },
          },
          classBooking: {
            select: {
              id: true,
              status: true,
              class: { select: { id: true, name: true } },
            },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              membership: { select: { id: true, name: true } },
            },
          },
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              fees: true,
              externalRef: true,
              dueDate: true,
              paidAt: true,
              meta: true,
              method: {
                select: {
                  id: true,
                  name: true,
                  logo: true,
                  channel: true,
                  fees: true,
                  percentage: true,
                },
              },
            },
          },
        },
      })

      if (!invoice) {
        return c.json(ok(null, 'Invoice not found'), status.NOT_FOUND)
      }

      // Parse stored meta JSON (if any)
      let storedMeta: any = null
      if (invoice.payment?.meta) {
        try {
          // Prisma already parses Json fields, no need to JSON.parse
          storedMeta =
            typeof invoice.payment.meta === 'string'
              ? JSON.parse(invoice.payment.meta)
              : invoice.payment.meta
        } catch (e) {
          c.var.logger.error(`Failed parsing payment meta: ${e}`)
        }
      }

      // Build payment instructions if pending/awaiting
      let paymentInstructions: any = null
      let paymentRequest: any = null
      if (
        invoice.payment &&
        [PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION].includes(
          invoice.payment.status,
        )
      ) {
        // Attempt to fetch live payment request details from Xendit v3
        const isMockPayment =
          storedMeta?.mock === true ||
          String(invoice.payment.externalRef || '').startsWith('mock_')
        if (
          invoice.payment.externalRef &&
          !isMockPayment &&
          !storedMeta?.payment_session_id
        ) {
          paymentRequest = await xenditService.getPaymentRequestV3(
            invoice.payment.externalRef,
          )
        }

        const channelCode =
          paymentRequest?.channel_code || storedMeta?.channel_code
        const channelProps =
          paymentRequest?.channel_properties ||
          storedMeta?.channel_properties ||
          {}
        const actions = Array.isArray(
          paymentRequest?.actions || storedMeta?.actions,
        )
          ? paymentRequest?.actions || storedMeta?.actions
          : []

        if (isVirtualAccountChannel(channelCode)) {
          const vaAction = actions.find(
            (action: any) =>
              String(action.descriptor || '').toUpperCase() ===
              'VIRTUAL_ACCOUNT_NUMBER',
          )
          paymentInstructions = {
            type: 'VIRTUAL_ACCOUNT',
            bankCode: channelProps.bank_code || channelProps.bank || null,
            accountNumber:
              vaAction?.value ||
              channelProps.virtual_account_number ||
              channelProps.account_number ||
              null,
            accountName: channelProps.account_name || null,
            expiresAt: invoice.payment.dueDate || null,
          }
        } else if (channelCode && channelCode.toUpperCase().includes('QR')) {
          // QRIS style
          paymentInstructions = {
            type: 'QRIS',
            qrString: channelProps.qr_string || null,
            qrImage:
              actions.find(
                (action: any) =>
                  action.descriptor === 'QR_STRING' ||
                  action.descriptor === 'QR_CODE',
              )?.value || null,
            expiresAt: invoice.payment.dueDate || null,
          }
        } else if (storedMeta?.invoiceUrl) {
          // Fallback to invoice URL if we only have legacy invoice meta
          paymentInstructions = {
            type: 'INVOICE_URL',
            url: storedMeta.invoiceUrl,
            expiresAt: invoice.payment.dueDate || null,
          }
        }
      }

      // Prefer the latest gateway response so a user reopening this invoice
      // receives the still-active payment instructions and redirect URL.
      const resolvedPaymentMeta = paymentRequest
        ? {
            ...(storedMeta || {}),
            ...paymentRequest,
            payment_request_id:
              paymentRequest.id || storedMeta?.payment_request_id,
            actions: paymentRequest.actions || storedMeta?.actions || [],
          }
        : storedMeta
      const resolvedActions = Array.isArray(resolvedPaymentMeta?.actions)
        ? resolvedPaymentMeta.actions
        : []
      const redirectAction = resolvedActions.find((action: any) => {
        const actionType = String(action?.type || '').toUpperCase()
        const descriptor = String(action?.descriptor || '').toUpperCase()
        return (
          actionType === 'REDIRECT' ||
          actionType === 'REDIRECT_CUSTOMER' ||
          descriptor === 'DEEPLINK_CHECKOUT' ||
          descriptor === 'WEB_URL' ||
          descriptor === 'MOBILE_URL'
        )
      })
      const paymentUrl =
        redirectAction?.url ||
        redirectAction?.value ||
        resolvedPaymentMeta?.invoiceUrl ||
        null

      const paymentForResponse = invoice.payment
        ? {
            ...invoice.payment,
            ...(hasValidShareToken
              ? { externalRef: undefined, meta: undefined }
              : {}),
            method: invoice.payment.method
              ? {
                  ...invoice.payment.method,
                  logo: await getFileUrl(invoice.payment.method.logo),
                }
              : null,
          }
        : null

      const responsePayload = {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        subtotal: invoice.subtotal,
        processingFee: invoice.processingFee,
        // promoCodeText: invoice.promoCodeText,
        promoDiscountAmount: invoice.promoDiscountAmount,
        total: invoice.total,
        issuedAt: invoice.issuedAt,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        user: hasValidShareToken
          ? { name: invoice.user.name, phone: invoice.user.phone }
          : invoice.user,
        booking: invoice.booking,
        classBooking: invoice.classBooking,
        membershipUser: invoice.membershipUser,
        payment: paymentForResponse,
        paymentMeta: hasValidShareToken ? null : resolvedPaymentMeta,
        paymentInstructions: hasValidShareToken ? null : paymentInstructions,
        paymentUrl: hasValidShareToken ? null : paymentUrl,
        shareToken: createInvoiceShareToken(invoice.number),
      }

      return c.json(
        ok(responsePayload, 'Invoice detail fetched successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in getInvoiceDetailHandler: ${error}`)
      throw error
    }
  },
)

// POST /invoices/:id/expire
// Manually expire a transaction when the frontend timer finishes
const expireInvoiceSchema = z.object({
  id: z.string(),
})

export const expireInvoiceHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', expireInvoiceSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const { id } = c.req.valid('param') as { id: string }

      // Find the invoice
      const invoice = await db.invoice.findUnique({
        where: { id },
        include: {
          payment: true,
          booking: true,
          classBooking: true,
          membershipUser: true,
        },
      })

      if (!invoice) {
        return c.json(
          { success: false, message: 'Invoice not found', data: null },
          status.NOT_FOUND,
        )
      }

      // Verify the invoice belongs to the user
      if (invoice.userId !== user.id) {
        return c.json(
          {
            success: false,
            message: 'Unauthorized access to invoice',
            data: null,
          },
          status.FORBIDDEN,
        )
      }

      // Only expire if status is PENDING
      if (invoice.status !== PaymentStatus.PENDING) {
        return c.json(
          {
            success: false,
            message: `Cannot expire invoice with status ${invoice.status}`,
            data: null,
          },
          status.BAD_REQUEST,
        )
      }

      const now = new Date()
      const paymentDeadline =
        invoice.dueDate ??
        invoice.payment?.dueDate ??
        invoice.booking?.holdExpiresAt
      if (!paymentDeadline || paymentDeadline > now) {
        throw new BadRequestException('Waktu pembayaran belum habis')
      }

      if (invoice.membershipUserId) {
        const changed = await cancelPendingMembershipPayment(
          invoice.id,
          'Waktu pembayaran habis',
          now,
          true,
        )
        if (!changed)
          throw new BadRequestException(
            'Waktu pembayaran belum habis atau transaksi sudah diproses',
          )
        return c.json(
          ok(
            { invoiceId: invoice.id, status: PaymentStatus.CANCELLED },
            'Waktu pembayaran habis',
          ),
          status.OK,
        )
      }

      // Perform the expiration in a transaction
      await db.$transaction(async (tx) => {
        // First, release slots if booking exists
        if (invoice.booking) {
          // Collect all slot IDs
          const bookingDetails = await tx.bookingDetail.findMany({
            where: { bookingId: invoice.booking.id },
            select: { slotId: true },
          })
          const courtSlotIds = bookingDetails.map((bd) => bd.slotId)

          const coachDetails = await tx.bookingCoach.findMany({
            where: { bookingId: invoice.booking.id },
            select: { slotId: true },
          })
          const coachSlotIds = coachDetails.map((bc) => bc.slotId)

          const ballboyDetails = await tx.bookingBallboy.findMany({
            where: { bookingId: invoice.booking.id },
            select: { slotId: true },
          })
          const ballboySlotIds = ballboyDetails.map((bb) => bb.slotId)

          const allSlotIds = [
            ...courtSlotIds,
            ...coachSlotIds,
            ...ballboySlotIds,
          ]

          // Release slots immediately BEFORE updating statuses
          if (allSlotIds.length > 0) {
            await tx.slot.updateMany({
              where: { id: { in: allSlotIds } },
              data: { isAvailable: true },
            })
          }
        }

        // Update payment status to EXPIRED if exists
        if (invoice.payment) {
          await tx.payment.update({
            where: { id: invoice.payment.id },
            data: {
              status: invoice.membershipUserId
                ? PaymentStatus.CANCELLED
                : PaymentStatus.EXPIRED,
              cancelledAt: invoice.membershipUserId ? now : undefined,
            },
          })
        }

        // Update invoice status to EXPIRED
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: invoice.membershipUserId
              ? PaymentStatus.CANCELLED
              : PaymentStatus.EXPIRED,
            cancelledAt: invoice.membershipUserId ? now : undefined,
          },
        })

        // Cancel booking if exists
        if (invoice.booking) {
          const restoredMembershipHours =
            await restoreMembershipHoursForBookingId(tx, invoice.booking.id)
          await restoreComplimentaryCreditsForBooking(tx, invoice.booking.id)
          await tx.booking.update({
            where: { id: invoice.booking.id },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: 'Payment expired (user timeout)',
              cancelledAt: now,
            },
          })
          await createBookingCancellationNotificationForBooking(tx, {
            bookingId: invoice.booking.id,
            invoiceNumber: invoice.number,
            reason: 'Pembayaran kedaluwarsa',
            restoredMembershipHours,
          })
        }

        // Cancel class booking and restore capacity if exists
        if (invoice.classBooking) {
          await tx.classBooking.update({
            where: { id: invoice.classBooking.id },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: 'Payment expired (user timeout)',
              cancelledAt: now,
            },
          })

          // Restore class capacity
          await tx.class.update({
            where: { id: invoice.classBooking.classId },
            data: {
              remaining: {
                increment: 1,
              },
            },
          })
        }

        // Preserve the unpaid membership and its invoice history
        if (invoice.membershipUser) {
          await tx.membershipUser.update({
            where: { id: invoice.membershipUser.id },
            data: cancelledMembershipData('Waktu pembayaran habis'),
          })
        }
      })

      c.var.logger.info(`Invoice ${invoice.id} expired by user ${user.id}`)

      return c.json(
        ok(
          { invoiceId: invoice.id, status: PaymentStatus.EXPIRED },
          'Invoice expired successfully',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in expireInvoiceHandler: ${error}`)
      throw error
    }
  },
)

// POST /invoices/:id/mock-pay
// Local development helper to mark a pending invoice as paid without Xendit.
export const mockPayInvoiceHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', z.object({ id: z.string().min(1) }), validateHook),
  async (c) => {
    if (env.nodeEnv === 'production' || env.paymentGatewayMode !== 'mock') {
      throw new BadRequestException('Mock payment is not enabled')
    }

    const user = c.get('user')
    if (!user || !user.id) {
      throw new Error('Unauthorized')
    }

    const { id } = c.req.valid('param') as { id: string }
    const now = new Date()

    const result = await db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          userId: user.id,
          OR: [{ id }, { number: id }],
        },
        include: {
          payment: true,
          booking: true,
          classBooking: true,
          membershipUser: true,
        },
      })

      if (!invoice) {
        throw new NotFoundException('Invoice not found')
      }

      if (invoice.status !== PaymentStatus.PENDING) {
        throw new BadRequestException(
          `Cannot mock-pay invoice with status ${invoice.status}`,
        )
      }

      if (invoice.payment) {
        await tx.payment.update({
          where: { id: invoice.payment.id },
          data: {
            status: PaymentStatus.PAID,
            paidAt: now,
            meta: {
              ...((invoice.payment.meta as Record<string, unknown> | null) ||
                {}),
              status: 'SUCCEEDED',
              mock: true,
              paid_at: now.toISOString(),
            },
          },
        })
      }

      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: now,
        },
      })

      if (invoice.booking) {
        await tx.booking.update({
          where: { id: invoice.booking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            holdExpiresAt: null,
          },
        })
      }

      if (invoice.classBooking) {
        await tx.classBooking.update({
          where: { id: invoice.classBooking.id },
          data: { status: BookingStatus.CONFIRMED },
        })
      }

      return updatedInvoice
    })

    return c.json(
      ok(
        {
          invoiceId: result.id,
          invoiceNumber: result.number,
          status: result.status,
          paidAt: result.paidAt,
        },
        'Mock payment completed',
      ),
      status.OK,
    )
  },
)

// Customer cancellation is disabled. Booking cancellations use admin endpoints.
export const cancelUserBookingHandler = factory.createHandlers(
  requireAuth,
  async () => {
    throw new ForbiddenException(
      'Pembatalan booking hanya dapat dilakukan oleh admin. Silakan hubungi admin.',
    )
  },
)
