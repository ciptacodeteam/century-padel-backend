/**
 * Fix slots that should be available but aren't
 * This script finds all slots associated with EXPIRED/CANCELLED bookings/invoices
 * and resets their isAvailable flag to true
 */

import { PrismaClient, BookingStatus, PaymentStatus } from '@prisma/client'

const db = new PrismaClient()

async function fixSlots() {
  console.log('🔍 Finding slots that need to be fixed...\n')

  try {
    const slotIdsToFix = new Set<string>()

    // Method 1: Find through expired/cancelled invoices
    console.log('📋 Checking invoices with EXPIRED/CANCELLED status...')
    const expiredInvoices = await db.invoice.findMany({
      where: {
        status: {
          in: [PaymentStatus.EXPIRED, PaymentStatus.CANCELLED],
        },
      },
      include: {
        booking: {
          include: {
            details: { select: { slotId: true } },
            coaches: { select: { slotId: true } },
            ballboys: { select: { slotId: true } },
          },
        },
      },
    })

    console.log(`   Found ${expiredInvoices.length} expired/cancelled invoices`)

    for (const invoice of expiredInvoices) {
      if (invoice.booking) {
        invoice.booking.details.forEach((d) => slotIdsToFix.add(d.slotId))
        invoice.booking.coaches.forEach((c) => slotIdsToFix.add(c.slotId))
        invoice.booking.ballboys.forEach((b) => slotIdsToFix.add(b.slotId))
      }
    }

    // Method 2: Find through cancelled bookings
    console.log('📋 Checking bookings with CANCELLED status...')
    const cancelledBookings = await db.booking.findMany({
      where: {
        status: BookingStatus.CANCELLED,
      },
      include: {
        details: { select: { slotId: true } },
        coaches: { select: { slotId: true } },
        ballboys: { select: { slotId: true } },
      },
    })

    console.log(`   Found ${cancelledBookings.length} cancelled bookings`)

    for (const booking of cancelledBookings) {
      booking.details.forEach((d) => slotIdsToFix.add(d.slotId))
      booking.coaches.forEach((c) => slotIdsToFix.add(c.slotId))
      booking.ballboys.forEach((b) => slotIdsToFix.add(b.slotId))
    }

    // Method 3: Find through expired payments
    console.log('📋 Checking payments with EXPIRED status...')
    const expiredPayments = await db.payment.findMany({
      where: {
        status: PaymentStatus.EXPIRED,
      },
      include: {
        invoice: {
          include: {
            booking: {
              include: {
                details: { select: { slotId: true } },
                coaches: { select: { slotId: true } },
                ballboys: { select: { slotId: true } },
              },
            },
          },
        },
      },
    })

    console.log(`   Found ${expiredPayments.length} expired payments`)

    for (const payment of expiredPayments) {
      if (payment.invoice?.booking) {
        payment.invoice.booking.details.forEach((d) =>
          slotIdsToFix.add(d.slotId),
        )
        payment.invoice.booking.coaches.forEach((c) =>
          slotIdsToFix.add(c.slotId),
        )
        payment.invoice.booking.ballboys.forEach((b) =>
          slotIdsToFix.add(b.slotId),
        )
      }
    }

    console.log(`\n📊 Total unique slots to check: ${slotIdsToFix.size}`)

    if (slotIdsToFix.size === 0) {
      console.log('✅ No slots found in expired/cancelled transactions!')
      return
    }

    // Find which of these slots are currently unavailable
    const slotsToUpdate = await db.slot.findMany({
      where: {
        id: { in: Array.from(slotIdsToFix) },
        isAvailable: false, // Only fix slots that are marked as unavailable
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        type: true,
      },
    })

    console.log(
      `\n🔧 Found ${slotsToUpdate.length} slots that need to be fixed:\n`,
    )

    if (slotsToUpdate.length === 0) {
      console.log('✅ All slots are already correctly marked as available!')
      return
    }

    // Show details of slots to be fixed
    slotsToUpdate.forEach((slot, index) => {
      console.log(
        `${index + 1}. ${slot.type} slot: ${slot.startAt.toISOString()} - ${slot.endAt.toISOString()}`,
      )
    })

    // Update the slots
    console.log(`\n🚀 Updating ${slotsToUpdate.length} slots to available...`)

    const result = await db.slot.updateMany({
      where: {
        id: { in: slotsToUpdate.map((s) => s.id) },
      },
      data: {
        isAvailable: true,
      },
    })

    console.log(`\n✅ Successfully updated ${result.count} slots!`)
    console.log('🎉 All slots are now correctly marked as available\n')
  } catch (error) {
    console.error('❌ Error fixing slots:', error)
    throw error
  } finally {
    await db.$disconnect()
  }
}

// Run the fix
fixSlots()
  .then(() => {
    console.log('✅ Fix completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error)
    process.exit(1)
  })
