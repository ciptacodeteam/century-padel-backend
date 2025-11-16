import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { XenditPaymentWebhook, xenditService } from '@/services/xendit.service'
import { BookingStatus, PaymentStatus } from '@prisma/client'

interface XenditWebhookPayload {
  id: string
  external_id: string
  status: 'PAID' | 'PENDING' | 'EXPIRED'
  user_id?: string
  merchant_name?: string
  merchant_profile_picture_url?: string
  payer_email?: string
  paid_amount?: number
  currency: string
  payment_method: string
  payment_channel?: string
  paid_at?: string
  create_time: string
  update_time: string
  description?: string
  items?: Array<{
    name: string
    quantity: number
    price: number
    category?: string
  }>
}

export const xenditWebhookHandler = factory.createHandlers(async (c) => {
  try {
    // Verify the callback token
    const callbackToken =
      c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

    c.var.logger.info(`Xendit webhook received. Has token: ${!!callbackToken}`)

    if (!callbackToken) {
      c.var.logger.error('Missing x-callback-token header')
      return c.json({ error: 'Missing callback token' }, 401)
    }

    if (!xenditService.verifyCallbackToken(callbackToken)) {
      c.var.logger.error(
        `Invalid Xendit callback token. Received token (first 10 chars): ${callbackToken.substring(0, 10)}...`,
      )
      return c.json({ error: 'Invalid callback token' }, 401)
    }

    const payload: any = await c.req.json()

    c.var.logger.info(
      `Xendit webhook received: ${JSON.stringify(payload, null, 2)}`,
    )

    // Check if this is a v3 payment webhook (has 'event' field)
    if (
      payload.event &&
      (payload.event === 'payment.capture' ||
        payload.event === 'payment.failure')
    ) {
      return await handlePaymentWebhookV3(c, payload as XenditPaymentWebhook)
    } else {
      // Legacy v2 invoice webhook
      return await handleInvoiceWebhookV2(c, payload as XenditWebhookPayload)
    }
  } catch (error) {
    c.var.logger.fatal(`Error processing Xendit webhook: ${error}`)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

// Handle v3 payment request webhooks
async function handlePaymentWebhookV3(c: any, webhook: XenditPaymentWebhook) {
  const { event, data } = webhook

  c.var.logger.info(
    `Processing v3 payment webhook: ${event} for reference_id: ${data.reference_id}`,
  )

  // Reference id should point to our invoice identifier (id or number)
  if (!data.reference_id) {
    c.var.logger.error('Missing reference_id in v3 payment webhook payload')
    return c.json({ error: 'Missing reference_id' }, 400)
  }

  // Find invoice by id or by number (supports either mapping)
  const invoice = await db.invoice.findFirst({
    where: {
      OR: [{ id: data.reference_id }, { number: data.reference_id }],
    },
    include: {
      booking: true,
      payment: true,
    },
  })

  if (!invoice) {
    c.var.logger.error(`Invoice not found: ${data.reference_id}`)
    return c.json({ error: 'Invoice not found' }, 404)
  }

  // Determine payment status based on event
  const paymentStatus =
    event === 'payment.capture' ? PaymentStatus.PAID : PaymentStatus.FAILED

  const paidAt =
    event === 'payment.capture'
      ? new Date(data.updated || data.created)
      : undefined

  // Update invoice status
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: paymentStatus,
      paidAt,
    },
  })

  // Update payment record
  if (invoice.payment) {
    await db.payment.update({
      where: { id: invoice.payment.id },
      data: {
        status: paymentStatus,
        paidAt,
        externalRef: data.payment_id,
        // Store as JSON object (Prisma will serialize it)
        meta: {
          payment_id: data.payment_id,
          payment_request_id: data.payment_request_id,
          reference_id: data.reference_id,
          channel_code: data.channel_code,
          captures: data.captures,
          payment_details: data.payment_details,
          failure_code: data.failure_code,
          status: data.status,
          request_amount: data.request_amount,
          currency: data.currency,
          metadata: data.metadata,
          updated: data.updated,
        },
      },
    })
  }

  // Update booking status
  if (invoice.bookingId) {
    if (event === 'payment.capture') {
      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
        },
      })
      c.var.logger.info(`Booking confirmed: ${invoice.bookingId}`)
    } else if (event === 'payment.failure') {
      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          cancelledAt: new Date(),
        },
      })
      c.var.logger.info(
        `Booking cancelled due to payment failure: ${invoice.bookingId}`,
      )
    }
  }

  // Handle class bookings
  if (invoice.classBookingId) {
    if (event === 'payment.capture') {
      await db.classBooking.update({
        where: { id: invoice.classBookingId },
        data: {
          status: BookingStatus.CONFIRMED,
        },
      })
      c.var.logger.info(`Class booking confirmed: ${invoice.classBookingId}`)
    } else if (event === 'payment.failure') {
      await db.classBooking.update({
        where: { id: invoice.classBookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          cancelledAt: new Date(),
        },
      })
      c.var.logger.info(`Class booking cancelled: ${invoice.classBookingId}`)
    }
  }

  // Handle membership purchases
  if (invoice.membershipUserId) {
    if (event === 'payment.capture') {
      // Membership is already active (created during checkout)
      // Just ensure it's not suspended or expired
      await db.membershipUser.update({
        where: { id: invoice.membershipUserId },
        data: {
          isExpired: false,
          isSuspended: false,
          suspensionReason: null,
          suspensionEndDate: null,
        },
      })
      c.var.logger.info(
        `Membership activated for user: ${invoice.membershipUserId}`,
      )
    } else if (event === 'payment.failure') {
      // Suspend the membership due to payment failure
      await db.membershipUser.update({
        where: { id: invoice.membershipUserId },
        data: {
          isSuspended: true,
          suspensionReason: `Payment failed: ${data.failure_code || 'Unknown error'}`,
          suspensionEndDate: null, // Suspended indefinitely until payment is resolved
        },
      })
      c.var.logger.warn(
        `Membership suspended due to payment failure: ${invoice.membershipUserId}`,
      )
    }
  }

  return c.json(ok(null, 'Webhook processed successfully'))
}

// Handle legacy v2 invoice webhooks
async function handleInvoiceWebhookV2(c: any, payload: XenditWebhookPayload) {
  c.var.logger.info(
    `Processing v2 invoice webhook: ${payload.status} for ${payload.external_id}`,
  )

  // external_id should point to our invoice identifier (id or number)
  if (!payload.external_id) {
    c.var.logger.error('Missing external_id in v2 invoice webhook payload')
    return c.json({ error: 'Missing external_id' }, 400)
  }

  // Find invoice by id or by number (supports either mapping)
  const invoice = await db.invoice.findFirst({
    where: {
      OR: [{ id: payload.external_id }, { number: payload.external_id }],
    },
    include: {
      booking: true,
      payment: true,
    },
  })

  if (!invoice) {
    c.var.logger.error(`Invoice not found: ${payload.external_id}`)
    return c.json({ error: 'Invoice not found' }, 404)
  }

  // Update invoice status
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status:
        payload.status === 'PAID'
          ? PaymentStatus.PAID
          : payload.status === 'EXPIRED'
            ? PaymentStatus.EXPIRED
            : PaymentStatus.PENDING,
      paidAt: payload.paid_at ? new Date(payload.paid_at) : undefined,
    },
  })

  // Update payment record
  if (invoice.payment) {
    await db.payment.update({
      where: { id: invoice.payment.id },
      data: {
        status:
          payload.status === 'PAID'
            ? PaymentStatus.PAID
            : payload.status === 'EXPIRED'
              ? PaymentStatus.EXPIRED
              : PaymentStatus.PENDING,
        paidAt: payload.paid_at ? new Date(payload.paid_at) : undefined,
        externalRef: payload.id,
      },
    })
  }

  // Update booking status
  if (invoice.bookingId) {
    if (payload.status === 'PAID') {
      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
        },
      })
      c.var.logger.info(`Booking confirmed: ${invoice.bookingId}`)
    } else if (payload.status === 'EXPIRED') {
      await db.booking.update({
        where: { id: invoice.bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: 'Payment expired',
          cancelledAt: new Date(),
        },
      })
      c.var.logger.info(
        `Booking cancelled due to expired payment: ${invoice.bookingId}`,
      )
    }
  }

  // Handle class bookings
  if (invoice.classBookingId) {
    const classBooking = await db.classBooking.findUnique({
      where: { id: invoice.classBookingId },
    })

    if (classBooking) {
      if (payload.status === 'PAID') {
        await db.classBooking.update({
          where: { id: invoice.classBookingId },
          data: {
            status: BookingStatus.CONFIRMED,
          },
        })
        c.var.logger.info(`Class booking confirmed: ${invoice.classBookingId}`)
      } else if (payload.status === 'EXPIRED') {
        await db.classBooking.update({
          where: { id: invoice.classBookingId },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Payment expired',
            cancelledAt: new Date(),
          },
        })
        c.var.logger.info(`Class booking cancelled: ${invoice.classBookingId}`)
      }
    }
  }

  // Handle membership purchases
  if (invoice.membershipUserId) {
    const membershipUser = await db.membershipUser.findUnique({
      where: { id: invoice.membershipUserId },
    })

    if (membershipUser) {
      if (payload.status === 'PAID') {
        // Membership is already active (created during checkout)
        // Just ensure it's not suspended or expired
        await db.membershipUser.update({
          where: { id: invoice.membershipUserId },
          data: {
            isExpired: false,
            isSuspended: false,
            suspensionReason: null,
            suspensionEndDate: null,
          },
        })
        c.var.logger.info(
          `Membership activated for user: ${invoice.membershipUserId}`,
        )
      } else if (payload.status === 'EXPIRED') {
        // Suspend the membership due to payment expiration
        await db.membershipUser.update({
          where: { id: invoice.membershipUserId },
          data: {
            isSuspended: true,
            suspensionReason: 'Payment expired',
            suspensionEndDate: null, // Suspended indefinitely
          },
        })
        c.var.logger.warn(
          `Membership suspended due to payment expiration: ${invoice.membershipUserId}`,
        )
      }
    }
  }

  return c.json(ok(null, 'Webhook processed successfully'))
}

// ==================== NEW V3 WEBHOOK HANDLERS ====================

// Payment Token Webhook Types
interface XenditPaymentTokenWebhook {
  created: string
  business_id: string
  event: 'payment_token.activation' | 'payment_token.deactivation'
  api_version: string
  data: {
    status: 'ACTIVE' | 'INACTIVE'
    payment_token_id: string
    reference_id: string
    currency: string
    country: string
    created: string
    updated: string
    channel_code: string
    channel_properties: any
    token_details?: any
  }
}

// Payment Request Webhook Types
interface XenditPaymentRequestWebhook {
  created: string
  business_id: string
  event:
    | 'payment_request.created'
    | 'payment_request.completed'
    | 'payment_request.failed'
    | 'payment_request.expired'
  api_version: string
  data: {
    id: string
    reference_id: string
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED'
    amount: number
    currency: string
    country: string
    payment_method: any
    created: string
    updated: string
  }
}

// Payment Status Webhook Types (existing)
interface XenditPaymentStatusWebhook {
  created: string
  business_id: string
  event: 'payment.capture' | 'payment.failure'
  api_version: string
  data: {
    id: string
    reference_id: string
    payment_request_id: string
    status: 'SUCCEEDED' | 'FAILED'
    amount: number
    currency: string
    channel_code: string
    created: string
    updated?: string
    failure_code?: string
  }
}

// Handler for Payment Token Status webhooks
export const xenditPaymentTokenWebhookHandler = factory.createHandlers(
  async (c) => {
    try {
      // Verify callback token
      const callbackToken =
        c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

      c.var.logger.info(
        `Xendit Payment Token webhook received. Has token: ${!!callbackToken}`,
      )

      if (!callbackToken) {
        c.var.logger.error('Missing x-callback-token header')
        return c.json({ error: 'Missing callback token' }, 401)
      }

      if (!xenditService.verifyCallbackToken(callbackToken)) {
        c.var.logger.error(`Invalid Xendit callback token`)
        return c.json({ error: 'Invalid callback token' }, 401)
      }

      const payload: XenditPaymentTokenWebhook = await c.req.json()

      c.var.logger.info(
        `Payment Token webhook received: ${payload.event} for token: ${payload.data.payment_token_id}`,
      )

      // Log the payment token event
      // In the future, you might want to store these tokens for recurring payments
      c.var.logger.info(
        `Payment Token ${payload.data.status}: ${payload.data.reference_id}`,
      )

      return c.json(ok(null, 'Payment token webhook processed'))
    } catch (error) {
      c.var.logger.fatal(`Error processing payment token webhook: ${error}`)
      return c.json({ error: 'Webhook processing failed' }, 500)
    }
  },
)

// Handler for Payment Request Status webhooks
export const xenditPaymentRequestWebhookHandler = factory.createHandlers(
  async (c) => {
    try {
      // Verify callback token
      const callbackToken =
        c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

      c.var.logger.info(
        `Xendit Payment Request webhook received. Has token: ${!!callbackToken}`,
      )

      if (!callbackToken) {
        c.var.logger.error('Missing x-callback-token header')
        return c.json({ error: 'Missing callback token' }, 401)
      }

      if (!xenditService.verifyCallbackToken(callbackToken)) {
        c.var.logger.error(`Invalid Xendit callback token`)
        return c.json({ error: 'Invalid callback token' }, 401)
      }

      const payload: XenditPaymentRequestWebhook = await c.req.json()

      c.var.logger.info(
        `Payment Request webhook received: ${payload.event} for reference: ${payload.data.reference_id}`,
      )

      // Find invoice by reference_id
      if (!payload.data.reference_id) {
        c.var.logger.error('Missing reference_id in payment request webhook')
        return c.json({ error: 'Missing reference_id' }, 400)
      }

      const invoice = await db.invoice.findFirst({
        where: {
          OR: [
            { id: payload.data.reference_id },
            { number: payload.data.reference_id },
          ],
        },
        include: {
          payment: true,
          booking: true,
          classBooking: true,
          membershipUser: true,
        },
      })

      if (!invoice) {
        c.var.logger.error(`Invoice not found: ${payload.data.reference_id}`)
        return c.json({ error: 'Invoice not found' }, 404)
      }

      // Map payment request status to our payment status
      let paymentStatus: PaymentStatus
      switch (payload.data.status) {
        case 'COMPLETED':
          paymentStatus = PaymentStatus.PAID
          break
        case 'FAILED':
          paymentStatus = PaymentStatus.FAILED
          break
        case 'EXPIRED':
          paymentStatus = PaymentStatus.EXPIRED
          break
        default:
          paymentStatus = PaymentStatus.PENDING
      }

      // Update invoice
      await db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: paymentStatus,
          paidAt:
            payload.data.status === 'COMPLETED'
              ? new Date(payload.data.updated)
              : undefined,
        },
      })

      // Update payment record
      if (invoice.payment) {
        await db.payment.update({
          where: { id: invoice.payment.id },
          data: {
            status: paymentStatus,
            paidAt:
              payload.data.status === 'COMPLETED'
                ? new Date(payload.data.updated)
                : undefined,
            meta: {
              ...(typeof invoice.payment.meta === 'object'
                ? invoice.payment.meta
                : {}),
              payment_request_id: payload.data.id,
              payment_request_status: payload.data.status,
              payment_request_event: payload.event,
            },
          },
        })
      }

      // Handle business logic based on status
      if (payload.data.status === 'COMPLETED') {
        // Update booking status
        if (invoice.bookingId) {
          await db.booking.update({
            where: { id: invoice.bookingId },
            data: { status: BookingStatus.CONFIRMED },
          })
          c.var.logger.info(`Booking confirmed: ${invoice.bookingId}`)
        }

        // Update class booking status
        if (invoice.classBookingId) {
          await db.classBooking.update({
            where: { id: invoice.classBookingId },
            data: { status: BookingStatus.CONFIRMED },
          })
          c.var.logger.info(
            `Class booking confirmed: ${invoice.classBookingId}`,
          )
        }

        // Activate membership
        if (invoice.membershipUserId) {
          await db.membershipUser.update({
            where: { id: invoice.membershipUserId },
            data: {
              isExpired: false,
              isSuspended: false,
              suspensionReason: null,
              suspensionEndDate: null,
            },
          })
          c.var.logger.info(`Membership activated: ${invoice.membershipUserId}`)
        }
      } else if (
        payload.data.status === 'FAILED' ||
        payload.data.status === 'EXPIRED'
      ) {
        // Cancel bookings
        if (invoice.bookingId) {
          await db.booking.update({
            where: { id: invoice.bookingId },
            data: { status: BookingStatus.CANCELLED },
          })
          c.var.logger.warn(`Booking cancelled: ${invoice.bookingId}`)
        }

        if (invoice.classBookingId) {
          await db.classBooking.update({
            where: { id: invoice.classBookingId },
            data: { status: BookingStatus.CANCELLED },
          })
          c.var.logger.warn(
            `Class booking cancelled: ${invoice.classBookingId}`,
          )
        }

        // Suspend membership
        if (invoice.membershipUserId) {
          await db.membershipUser.update({
            where: { id: invoice.membershipUserId },
            data: {
              isSuspended: true,
              suspensionReason: `Payment ${payload.data.status.toLowerCase()}`,
              suspensionEndDate: null,
            },
          })
          c.var.logger.warn(`Membership suspended: ${invoice.membershipUserId}`)
        }
      }

      return c.json(ok(null, 'Payment request webhook processed'))
    } catch (error) {
      c.var.logger.fatal(`Error processing payment request webhook: ${error}`)
      return c.json({ error: 'Webhook processing failed' }, 500)
    }
  },
)

// Handler for Payment Status webhooks (renamed from existing)
export const xenditPaymentStatusWebhookHandler = factory.createHandlers(
  async (c) => {
    try {
      // Verify callback token
      const callbackToken =
        c.req.header('x-callback-token') || c.req.header('X-Callback-Token')

      c.var.logger.info(
        `Xendit Payment Status webhook received. Has token: ${!!callbackToken}`,
      )

      if (!callbackToken) {
        c.var.logger.error('Missing x-callback-token header')
        return c.json({ error: 'Missing callback token' }, 401)
      }

      if (!xenditService.verifyCallbackToken(callbackToken)) {
        c.var.logger.error(`Invalid Xendit callback token`)
        return c.json({ error: 'Invalid callback token' }, 401)
      }

      const payload: XenditPaymentStatusWebhook = await c.req.json()

      c.var.logger.info(
        `Payment Status webhook received: ${payload.event} for reference: ${payload.data.reference_id}`,
      )

      // Use the existing v3 payment handler
      return await handlePaymentWebhookV3(c, payload as any)
    } catch (error) {
      c.var.logger.fatal(`Error processing payment status webhook: ${error}`)
      return c.json({ error: 'Webhook processing failed' }, 500)
    }
  },
)
