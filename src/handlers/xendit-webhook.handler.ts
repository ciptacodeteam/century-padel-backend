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

  // Find the invoice by reference_id (which is our invoice ID)
  const invoice = await db.invoice.findUnique({
    where: { id: data.reference_id },
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
      c.var.logger.info(
        `Membership payment confirmed: ${invoice.membershipUserId}`,
      )
    } else if (event === 'payment.failure') {
      c.var.logger.warn(
        `Membership payment failed: ${invoice.membershipUserId}`,
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

  // Find the invoice by external_id (which is our invoice ID)
  const invoice = await db.invoice.findUnique({
    where: { id: payload.external_id },
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
        // Membership is already activated, no need to change status
        c.var.logger.info(
          `Membership payment confirmed: ${invoice.membershipUserId}`,
        )
      } else if (payload.status === 'EXPIRED') {
        // You might want to handle this differently for memberships
        c.var.logger.warn(
          `Membership payment expired: ${invoice.membershipUserId}`,
        )
      }
    }
  }

  return c.json(ok(null, 'Webhook processed successfully'))
}
