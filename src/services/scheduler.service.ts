import { Queue, Worker } from 'bullmq'
import { db } from '@/lib/prisma'
import { BookingStatus, PaymentStatus } from '@prisma/client'
import { log } from '@/lib/logger'
import { getRedisConnection } from '@/lib/redis'

const redisConnection = getRedisConnection()

// Queue for scheduled tasks
const schedulerQueue = new Queue('scheduler', {
  connection: redisConnection,
})

/**
 * Check for expired payments and update their status
 * This runs every minute to check for:
 * - Invoices past their dueDate with PENDING status
 * - Payments past their dueDate with PENDING status
 * - Bookings past their holdExpiresAt with HOLD status
 */
export async function checkExpiredTransactions() {
  const now = new Date()

  try {
    // Find expired payments
    const expiredPayments = await db.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        dueDate: {
          lte: now,
        },
      },
      include: {
        invoice: {
          include: {
            booking: true,
            classBooking: true,
            membershipUser: true,
          },
        },
      },
    })

    log.info(`Found ${expiredPayments.length} expired payments to process`)

    // Update expired payments and related records
    for (const payment of expiredPayments) {
      await db.$transaction(async (tx) => {
        // First, release slots if booking exists
        if (payment.invoice?.booking) {
          // Collect all slot IDs
          const bookingDetails = await tx.bookingDetail.findMany({
            where: { bookingId: payment.invoice.booking.id },
            select: { slotId: true },
          })
          const courtSlotIds = bookingDetails.map((bd) => bd.slotId)

          const coachDetails = await tx.bookingCoach.findMany({
            where: { bookingId: payment.invoice.booking.id },
            select: { slotId: true },
          })
          const coachSlotIds = coachDetails.map((bc) => bc.slotId)

          const ballboyDetails = await tx.bookingBallboy.findMany({
            where: { bookingId: payment.invoice.booking.id },
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
            log.info(
              `Released ${allSlotIds.length} slots for booking ${payment.invoice.booking.id}`,
            )
          }
        }

        // Update payment status to EXPIRED
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.EXPIRED,
          },
        })

        // Update invoice status to EXPIRED
        if (payment.invoice) {
          await tx.invoice.update({
            where: { id: payment.invoice.id },
            data: {
              status: PaymentStatus.EXPIRED,
            },
          })

          // Update booking status to CANCELLED if exists
          if (payment.invoice.booking) {
            await tx.booking.update({
              where: { id: payment.invoice.booking.id },
              data: {
                status: BookingStatus.CANCELLED,
                cancellationReason: 'Payment expired',
                cancelledAt: now,
              },
            })
          }

          // Update class booking status to CANCELLED if exists
          if (payment.invoice.classBooking) {
            await tx.classBooking.update({
              where: { id: payment.invoice.classBooking.id },
              data: {
                status: BookingStatus.CANCELLED,
                cancellationReason: 'Payment expired',
                cancelledAt: now,
              },
            })

            // Restore class capacity
            const classBooking = payment.invoice.classBooking
            await tx.class.update({
              where: { id: classBooking.classId },
              data: {
                remaining: {
                  increment: 1,
                },
              },
            })
          }

          // Delete membership user if payment expired (not yet activated)
          if (payment.invoice.membershipUser) {
            await tx.membershipUser.delete({
              where: { id: payment.invoice.membershipUser.id },
            })
            log.info(
              `Deleted unpaid membership ${payment.invoice.membershipUser.id}`,
            )
          }
        }

        log.info(`Expired payment ${payment.id} and related records`)
      })
    }

    // Also check for bookings with expired holdExpiresAt (backup check)
    const expiredHoldBookings = await db.booking.findMany({
      where: {
        status: BookingStatus.HOLD,
        holdExpiresAt: {
          lte: now,
        },
      },
    })

    log.info(
      `Found ${expiredHoldBookings.length} expired hold bookings to process`,
    )

    for (const booking of expiredHoldBookings) {
      await db.$transaction(async (tx) => {
        // First, collect and release slots
        const bookingDetails = await tx.bookingDetail.findMany({
          where: { bookingId: booking.id },
          select: { slotId: true },
        })
        const courtSlotIds = bookingDetails.map((bd) => bd.slotId)

        const coachDetails = await tx.bookingCoach.findMany({
          where: { bookingId: booking.id },
          select: { slotId: true },
        })
        const coachSlotIds = coachDetails.map((bc) => bc.slotId)

        const ballboyDetails = await tx.bookingBallboy.findMany({
          where: { bookingId: booking.id },
          select: { slotId: true },
        })
        const ballboySlotIds = ballboyDetails.map((bb) => bb.slotId)

        const allSlotIds = [...courtSlotIds, ...coachSlotIds, ...ballboySlotIds]

        // Release slots immediately BEFORE updating statuses
        if (allSlotIds.length > 0) {
          await tx.slot.updateMany({
            where: { id: { in: allSlotIds } },
            data: { isAvailable: true },
          })
          log.info(
            `Released ${allSlotIds.length} slots for expired hold booking ${booking.id}`,
          )
        }

        // Update booking status to CANCELLED
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancellationReason: 'Hold period expired',
            cancelledAt: now,
          },
        })

        // Update related invoice status if exists
        const invoice = await tx.invoice.findFirst({
          where: { bookingId: booking.id },
        })
        if (invoice && invoice.status === PaymentStatus.PENDING) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: PaymentStatus.EXPIRED },
          })
        }
      })
    }

    return {
      expiredPayments: expiredPayments.length,
      expiredHoldBookings: expiredHoldBookings.length,
    }
  } catch (error) {
    log.error(`Error checking expired transactions: ${error}`)
    throw error
  }
}

/**
 * Add a job to check expired transactions every minute
 */
export async function scheduleExpiryCheck() {
  try {
    // Remove existing repeatable jobs with the same pattern
    const repeatableJobs = await schedulerQueue.getRepeatableJobs()
    for (const job of repeatableJobs) {
      if (job.name === 'check-expired-transactions') {
        await schedulerQueue.removeRepeatableByKey(job.key)
      }
    }

    // Add new repeatable job - runs every minute
    await schedulerQueue.add(
      'check-expired-transactions',
      {},
      {
        repeat: {
          pattern: '* * * * *', // Every minute
        },
      },
    )

    log.info('Scheduled expiry check job to run every minute')
  } catch (error) {
    log.error(`Error scheduling expiry check: ${error}`)
    throw error
  }
}

/**
 * Worker to process scheduled tasks
 */
export function startSchedulerWorker() {
  const worker = new Worker(
    'scheduler',
    async (job) => {
      if (job.name === 'check-expired-transactions') {
        log.info('Running scheduled expiry check...')
        const result = await checkExpiredTransactions()
        log.info(
          `Expiry check completed: ${result.expiredPayments} payments, ${result.expiredHoldBookings} hold bookings expired`,
        )
        return result
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Process one at a time to avoid race conditions
    },
  )

  worker.on('completed', (job) => {
    log.info(`Scheduler job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    log.error(`Scheduler job ${job?.id} failed: ${err.message}`)
  })

  log.info('Scheduler worker started')

  return worker
}
