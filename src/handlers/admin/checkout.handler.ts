import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { generateInvoiceNumber, formatPhone } from '@/lib/utils'
import { zValidator } from '@hono/zod-validator'
import {
  BookingStatus,
  MembershipUser,
  PaymentStatus,
  SlotType,
} from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'
import { hashPassword } from '@/lib/password'

const adminCheckoutSchema = z
  .object({
    userId: z.string().optional(),
    name: z.string().min(1).optional(),
    phone: z.string().min(5).optional(),
    totalHours: z.number().positive(),
    courtSlots: z.array(z.string()).optional(),
    coachSlots: z.array(z.string()).optional(),
    // Optional description for coach booking – e.g. names of up to 4 members
    coachDescription: z.string().max(500).optional(),
    ballboySlots: z.array(z.string()).optional(),
    inventories: z
      .array(
        z.object({
          inventoryId: z.string(),
          quantity: z.number().int().positive(),
        }),
      )
      .optional(),
  })
  .refine(
    (data) => {
      // Must provide either userId or (name and phone)
      return !!data.userId || (!!data.name && !!data.phone)
    },
    {
      message:
        'Provide either userId or both name and phone for a new customer',
      path: ['userId'],
    },
  )

type AdminCheckoutSchema = z.infer<typeof adminCheckoutSchema>

export const adminCheckoutHandler = factory.createHandlers(
  zValidator('json', adminCheckoutSchema, validateHook),
  async (c) => {
    const {
      userId: inputUserId,
      name,
      phone,
      totalHours,
      courtSlots,
      coachSlots,
      coachDescription,
      ballboySlots,
      inventories,
    } = c.req.valid('json') as AdminCheckoutSchema

    // Get the admin (cashier) creating this booking
    const admin = c.get('admin')
    const cashierId = admin?.id || null

    // Ensure at least one item is provided
    const hasItems =
      (courtSlots && courtSlots.length > 0) ||
      (coachSlots && coachSlots.length > 0) ||
      (ballboySlots && ballboySlots.length > 0) ||
      (inventories && inventories.length > 0)
    if (!hasItems) {
      return c.json(
        {
          success: false,
          message: 'At least one slot or inventory must be provided',
          data: null,
        },
        status.BAD_REQUEST,
      )
    }

    try {
      const result = await db.$transaction(async (tx) => {
        // Resolve or create user
        let resolvedUserId = inputUserId
        if (!resolvedUserId) {
          const formattedPhone = await formatPhone(phone!)
          // Try find by phone
          const existingByPhone = await tx.user.findUnique({
            where: { phone: formattedPhone },
            select: { id: true },
          })
          if (existingByPhone) {
            resolvedUserId = existingByPhone.id
          } else {
            // Create new user with password set to phone number
            const hashed = await hashPassword(formattedPhone)
            const created = await tx.user.create({
              data: {
                name: name!,
                phone: formattedPhone,
                password: hashed,
              },
              select: { id: true },
            })
            resolvedUserId = created.id
          }
        } else {
          // Validate provided userId exists
          const user = await tx.user.findUnique({
            where: { id: resolvedUserId },
            select: { id: true },
          })
          if (!user) {
            throw new NotFoundException('User not found')
          }
        }

        // Check for active membership BEFORE calculating prices
        // This determines if court costs should be excluded from totalPrice
        let activeMembership: MembershipUser | null = null
        if (totalHours > 0) {
          const now = new Date()
          activeMembership = await tx.membershipUser.findFirst({
            where: {
              userId: resolvedUserId!,
              isExpired: false,
              isSuspended: false,
              startDate: { lte: now }, // Membership must have started
              endDate: { gt: now }, // Membership must not have expired
              remainingSessions: { gte: totalHours }, // Must have enough sessions
            },
            orderBy: {
              endDate: 'asc', // Use membership that expires first
            },
          })
        }

        // Create booking in CONFIRMED state (admin bypasses payment)
        const booking = await tx.booking.create({
          data: {
            userId: resolvedUserId!,
            status: BookingStatus.CONFIRMED,
            totalPrice: 0,
            processingFee: 0,
            holdExpiresAt: null,
            ...(cashierId && { cashierId }),
          },
        })

        let totalPrice = 0
        let courtCostCoveredByMembership = 0 // Track court costs covered by membership
        let totalDiscount = 0 // Track total discount applied for overlapping court+coach
        // Map "YYYY-MM-DD-HH" -> court slot info so we can detect overlaps with coach slots
        const courtTimeMap = new Map<
          string,
          { band: 'HAPPY' | 'PEAK' | 'OTHER'; courtPrice: number }
        >()
        const discountedTimeKeys = new Set<string>() // ensure only one discount per overlapping hour
        const bookedItems = {
          courtSlots: [] as string[],
          coachSlots: [] as string[],
          ballboySlots: [] as string[],
          inventories: [] as Array<{ inventoryId: string; quantity: number }>,
        }

        // Courts
        if (courtSlots && courtSlots.length > 0) {
          const slotData = await tx.slot.findMany({
            where: {
              id: { in: courtSlots },
              type: SlotType.COURT,
              isAvailable: true,
            },
            include: {
              bookingDetails: {
                where: {
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })
          if (slotData.length !== courtSlots.length) {
            throw new BadRequestException(
              'One or more court slots not found or unavailable',
            )
          }
          for (const slot of slotData) {
            if (slot.bookingDetails.length > 0) {
              throw new BadRequestException(
                'One or more court slots are already booked',
              )
            }

            // Store original price for record-keeping
            const slotPrice = slot.price

            // Track this court slot's time band (happy / peak / other) for discount logic
            const start = dayjs(slot.startAt)
            const hour = start.hour()
            const key = `${start.format('YYYY-MM-DD')}-${hour}`
            let band: 'HAPPY' | 'PEAK' | 'OTHER' = 'OTHER'
            if (hour >= 6 && hour < 15) {
              band = 'HAPPY'
            } else if (hour >= 15 && hour < 24) {
              band = 'PEAK'
            }
            courtTimeMap.set(key, { band, courtPrice: slotPrice })

            // If membership covers this booking, exclude court costs from totalPrice
            // but still track the original price
            if (activeMembership) {
              courtCostCoveredByMembership += slotPrice
              // Don't add to totalPrice - membership covers it
            } else {
              totalPrice += slotPrice
            }

            await tx.bookingDetail.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                price: slotPrice, // Always store original price for records
                courtId: slot.courtId || undefined,
              },
            })
            bookedItems.courtSlots.push(slot.id)
          }
          // Update slots to unavailable
          await tx.slot.updateMany({
            where: {
              id: { in: courtSlots },
            },
            data: {
              isAvailable: false,
            },
          })
        }

        // Coaches
        if (coachSlots && coachSlots.length > 0) {
          c.var.logger.info(
            `Processing ${coachSlots.length} coach slots: ${coachSlots.join(', ')}`,
          )
          const slotData = await tx.slot.findMany({
            where: {
              id: { in: coachSlots },
              type: SlotType.COACH,
              isAvailable: true,
            },
            include: {
              bookingCoaches: {
                where: {
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })
          if (slotData.length !== coachSlots.length) {
            c.var.logger.warn(
              `Coach slots mismatch: requested ${coachSlots.length}, found ${slotData.length}. ` +
                `Requested IDs: ${coachSlots.join(', ')}. ` +
                `Found IDs: ${slotData.map((s) => s.id).join(', ')}`,
            )
            throw new BadRequestException(
              'One or more coach slots not found or unavailable',
            )
          }
          // Use a generic coach type; if none exists, create a default one.
          let defaultCoachType = await tx.bookingCoachType.findFirst()
          if (!defaultCoachType) {
            defaultCoachType = await tx.bookingCoachType.create({
              data: {
                name: 'Default',
                description:
                  'Auto-created default coach type for admin checkout',
              },
            })
          }
          for (const slot of slotData) {
            if (slot.bookingCoaches.length > 0) {
              throw new BadRequestException(
                'One or more coach slots are already booked',
              )
            }

            // Before adding coach price, check if there is a court slot with the same time.
            // If so, apply a discount on the court price for that hour:
            // - Happy hour (06–14) -> Rp 100.000
            // - Peak hour  (15–23) -> Rp 70.000
            // Discount only applies once per overlapping hour and only when
            // court cost is actually being charged (no active membership).
            const start = dayjs(slot.startAt)
            const hour = start.hour()
            const key = `${start.format('YYYY-MM-DD')}-${hour}`
            const courtInfo = courtTimeMap.get(key)
            if (
              courtInfo &&
              !activeMembership &&
              !discountedTimeKeys.has(key)
            ) {
              let discountBase = 0
              if (courtInfo.band === 'HAPPY') {
                discountBase = 100_000
              } else if (courtInfo.band === 'PEAK') {
                discountBase = 70_000
              }
              if (discountBase > 0) {
                const applied = Math.min(discountBase, courtInfo.courtPrice)
                if (applied > 0) {
                  totalPrice = Math.max(0, totalPrice - applied)
                  totalDiscount += applied
                  discountedTimeKeys.add(key)
                  c.var.logger.info(
                    `Applied court discount of ${applied} for overlapping coach slot at ${key} (band=${courtInfo.band}). Total discount so far: ${totalDiscount}`,
                  )
                }
              }
            }
            totalPrice += slot.price
            await tx.bookingCoach.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                bookingCoachTypeId: defaultCoachType.id,
                // Store names of members joining this coach session (if provided)
                description: coachDescription?.trim() || undefined,
                price: slot.price,
              },
            })
            bookedItems.coachSlots.push(slot.id)
            c.var.logger.info(
              `Coach slot ${slot.id} booked successfully. Price: ${slot.price}`,
            )
          }
          c.var.logger.info(
            `Total coach slots booked: ${bookedItems.coachSlots.length}. Total coach price: ${slotData.reduce((sum, s) => sum + s.price, 0)}`,
          )
          // Update slots to unavailable
          await tx.slot.updateMany({
            where: {
              id: { in: coachSlots },
            },
            data: {
              isAvailable: false,
            },
          })
        }

        // Ballboys
        if (ballboySlots && ballboySlots.length > 0) {
          const slotData = await tx.slot.findMany({
            where: {
              id: { in: ballboySlots },
              type: SlotType.BALLBOY,
              isAvailable: true,
            },
            include: {
              bookingBallboys: {
                where: {
                  booking: {
                    status: {
                      not: BookingStatus.CANCELLED,
                    },
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          })
          if (slotData.length !== ballboySlots.length) {
            throw new BadRequestException(
              'One or more ballboy slots not found or unavailable',
            )
          }
          for (const slot of slotData) {
            if (slot.bookingBallboys.length > 0) {
              throw new BadRequestException(
                'One or more ballboy slots are already booked',
              )
            }
            totalPrice += slot.price
            await tx.bookingBallboy.create({
              data: {
                bookingId: booking.id,
                slotId: slot.id,
                price: slot.price,
              },
            })
            bookedItems.ballboySlots.push(slot.id)
          }
          // Update slots to unavailable
          await tx.slot.updateMany({
            where: {
              id: { in: ballboySlots },
            },
            data: {
              isAvailable: false,
            },
          })
        }

        // Inventories
        if (inventories && inventories.length > 0) {
          for (const inv of inventories) {
            const inventory = await tx.inventory.findUnique({
              where: { id: inv.inventoryId },
            })
            if (!inventory) {
              throw new NotFoundException(
                `Inventory ${inv.inventoryId} not found`,
              )
            }
            if (!inventory.isActive) {
              throw new BadRequestException(
                `Inventory ${inventory.name} is not active`,
              )
            }
            if (inventory.quantity < inv.quantity) {
              throw new BadRequestException(
                `Insufficient quantity for ${inventory.name}`,
              )
            }
            const inventoryPrice = inventory.price * inv.quantity
            totalPrice += inventoryPrice
            await tx.bookingInventory.create({
              data: {
                bookingId: booking.id,
                inventoryId: inv.inventoryId,
                quantity: inv.quantity,
                price: inventory.price,
              },
            })
            bookedItems.inventories.push({
              inventoryId: inv.inventoryId,
              quantity: inv.quantity,
            })
            // Decrement inventory stock
            await tx.inventory.update({
              where: { id: inv.inventoryId },
              data: {
                quantity: { decrement: inv.quantity },
              },
            })
          }
        }

        // Deduct totalHours from user's active membership sessions
        // (Membership was already checked earlier if it exists)
        if (activeMembership && totalHours > 0) {
          const newRemainingSessions = Math.max(
            0,
            activeMembership.remainingSessions - totalHours,
          )

          await tx.membershipUser.update({
            where: { id: activeMembership.id },
            data: {
              remainingSessions: newRemainingSessions,
              // Mark as expired if no sessions left
              isExpired: newRemainingSessions === 0,
            },
          })

          // Log for tracking
          c.var.logger.info(
            `Deducted ${totalHours} hours from membership ${activeMembership.id}. ` +
              `Court cost covered: ${courtCostCoveredByMembership}. ` +
              `Remaining: ${newRemainingSessions} sessions`,
          )
        } else if (totalHours > 0) {
          // No active membership with available sessions
          c.var.logger.warn(
            `User ${resolvedUserId} has no active membership with available sessions for ${totalHours} hours`,
          )
        }

        // Update totals on booking
        // (totalPrice already excludes court costs if covered by membership)
        const processingFee = 0
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            totalPrice,
            processingFee,
          },
        })

        // Generate invoice (marked as PAID immediately)
        const invoiceNumber = await generateInvoiceNumber()
        const invoice = await tx.invoice.create({
          data: {
            userId: resolvedUserId!,
            bookingId: booking.id,
            number: invoiceNumber,
            subtotal: totalPrice,
            processingFee,
            total: totalPrice + processingFee,
            status: PaymentStatus.PAID,
            dueDate: dayjs().add(5, 'minutes').toDate(),
            issuedAt: new Date(),
            paidAt: new Date(),
          },
        })

        return {
          bookingId: booking.id,
          invoiceId: invoice.id,
          totalPrice,
          processingFee,
          totalHours,
          bookedItems,
        }
      })

      return c.json(
        ok(
          {
            bookingId: result.bookingId,
            invoiceId: result.invoiceId,
            totalPrice: result.totalPrice,
            processingFee: result.processingFee,
            totalHours: result.totalHours,
            status: BookingStatus.CONFIRMED,
            paymentStatus: PaymentStatus.PAID,
            bookedItems: result.bookedItems,
          },
          'Admin checkout successful (payment bypassed)',
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error during admin checkout: ${error}`)
      throw error
    }
  },
)
