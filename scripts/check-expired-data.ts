/**
 * Check the current state of expired payments and their related data
 */

import { db } from '../src/lib/prisma'
import { PaymentStatus } from '@prisma/client'

async function checkExpiredData() {
  console.log('🔍 Checking expired payments and slots...\n')

  try {
    // Check expired invoices
    const expiredInvoices = await db.invoice.findMany({
      where: {
        status: {
          in: [PaymentStatus.EXPIRED, PaymentStatus.CANCELLED],
        },
      },
      include: {
        booking: {
          include: {
            details: {
              include: {
                slot: { select: { id: true, isAvailable: true } },
              },
            },
            coaches: {
              include: {
                slot: { select: { id: true, isAvailable: true } },
              },
            },
            ballboys: {
              include: {
                slot: { select: { id: true, isAvailable: true } },
              },
            },
          },
        },
        payment: { select: { status: true } },
      },
    })

    console.log(
      `📊 Found ${expiredInvoices.length} expired/cancelled invoices\n`,
    )

    if (expiredInvoices.length === 0) {
      console.log('✅ No expired invoices found')
      return
    }

    for (const invoice of expiredInvoices) {
      console.log(`\n📋 Invoice ${invoice.number}:`)
      console.log(`   Status: ${invoice.status}`)
      console.log(`   Payment Status: ${invoice.payment?.status || 'N/A'}`)

      if (invoice.booking) {
        console.log(`   Booking ID: ${invoice.booking.id}`)
        console.log(`   Booking Status: ${invoice.booking.status}`)

        // Check court slots
        if (invoice.booking.details.length > 0) {
          console.log(`   Court Slots (${invoice.booking.details.length}):`)
          invoice.booking.details.forEach((detail) => {
            console.log(
              `      - Slot ${detail.slotId}: isAvailable = ${detail.slot.isAvailable}`,
            )
          })
        }

        // Check coach slots
        if (invoice.booking.coaches.length > 0) {
          console.log(`   Coach Slots (${invoice.booking.coaches.length}):`)
          invoice.booking.coaches.forEach((coach) => {
            console.log(
              `      - Slot ${coach.slotId}: isAvailable = ${coach.slot.isAvailable}`,
            )
          })
        }

        // Check ballboy slots
        if (invoice.booking.ballboys.length > 0) {
          console.log(`   Ballboy Slots (${invoice.booking.ballboys.length}):`)
          invoice.booking.ballboys.forEach((ballboy) => {
            console.log(
              `      - Slot ${ballboy.slotId}: isAvailable = ${ballboy.slot.isAvailable}`,
            )
          })
        }
      } else {
        console.log(`   No booking associated`)
      }
    }

    // Summary
    console.log('\n\n📈 SUMMARY:')
    let totalSlots = 0
    let unavailableSlots = 0

    for (const invoice of expiredInvoices) {
      if (invoice.booking) {
        invoice.booking.details.forEach((d) => {
          totalSlots++
          if (!d.slot.isAvailable) unavailableSlots++
        })
        invoice.booking.coaches.forEach((c) => {
          totalSlots++
          if (!c.slot.isAvailable) unavailableSlots++
        })
        invoice.booking.ballboys.forEach((b) => {
          totalSlots++
          if (!b.slot.isAvailable) unavailableSlots++
        })
      }
    }

    console.log(`Total slots in expired bookings: ${totalSlots}`)
    console.log(`Slots marked as unavailable: ${unavailableSlots}`)
    console.log(`Slots marked as available: ${totalSlots - unavailableSlots}`)

    if (unavailableSlots > 0) {
      console.log(`\n⚠️  ${unavailableSlots} slots need to be fixed!`)
    } else {
      console.log('\n✅ All slots are correctly marked as available')
    }
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await db.$disconnect()
  }
}

checkExpiredData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
