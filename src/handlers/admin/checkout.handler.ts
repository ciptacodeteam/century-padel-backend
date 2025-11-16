import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, PaymentStatus, SlotType } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'

const adminCheckoutSchema = z.object({
	userId: z.string(),
	courtSlots: z.array(z.string()).optional(),
	coachSlots: z.array(z.string()).optional(),
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

type AdminCheckoutSchema = z.infer<typeof adminCheckoutSchema>

export const adminCheckoutHandler = factory.createHandlers(
	zValidator('json', adminCheckoutSchema, validateHook),
	async (c) => {
		const {
			userId,
			courtSlots,
			coachSlots,
			ballboySlots,
			inventories,
		} = c.req.valid('json') as AdminCheckoutSchema

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
				// Validate user exists
				const user = await tx.user.findUnique({
					where: { id: userId },
					select: { id: true },
				})
				if (!user) {
					throw new NotFoundException('User not found')
				}

				// Create booking in CONFIRMED state (admin bypasses payment)
				const booking = await tx.booking.create({
					data: {
						userId: userId,
						status: BookingStatus.CONFIRMED,
						totalPrice: 0,
						processingFee: 0,
						holdExpiresAt: null,
					},
				})

				let totalPrice = 0

				// Courts
				if (courtSlots && courtSlots.length > 0) {
					const slotData = await tx.slot.findMany({
						where: {
							id: { in: courtSlots },
							type: SlotType.COURT,
							isAvailable: true,
						},
						include: {
							bookingDetails: { select: { id: true }, take: 1 },
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
						totalPrice += slot.price
						await tx.bookingDetail.create({
							data: {
								bookingId: booking.id,
								slotId: slot.id,
								price: slot.price,
								courtId: slot.courtId || undefined,
							},
						})
					}
				}

				// Coaches
				if (coachSlots && coachSlots.length > 0) {
					const slotData = await tx.slot.findMany({
						where: {
							id: { in: coachSlots },
							type: SlotType.COACH,
							isAvailable: true,
						},
						include: {
							bookingCoaches: { select: { id: true }, take: 1 },
						},
					})
					if (slotData.length !== coachSlots.length) {
						throw new BadRequestException(
							'One or more coach slots not found or unavailable',
						)
					}
					// Choose a default coach type (same approach as public checkout)
					const coachTypes = await tx.bookingCoachType.findMany()
					const firstCoachType = coachTypes[0]
					if (!firstCoachType) {
						throw new BadRequestException('No coach types available')
					}
					for (const slot of slotData) {
						if (slot.bookingCoaches.length > 0) {
							throw new BadRequestException(
								'One or more coach slots are already booked',
							)
						}
						totalPrice += slot.price
						await tx.bookingCoach.create({
							data: {
								bookingId: booking.id,
								slotId: slot.id,
								bookingCoachTypeId: firstCoachType.id,
								price: slot.price,
							},
						})
					}
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
							bookingBallboys: { select: { id: true }, take: 1 },
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
					}
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
						// Decrement inventory stock
						await tx.inventory.update({
							where: { id: inv.inventoryId },
							data: {
								quantity: { decrement: inv.quantity },
							},
						})
					}
				}

				// Update totals on booking
				const processingFee = 0
				await tx.booking.update({
					where: { id: booking.id },
					data: {
						totalPrice,
						processingFee,
					},
				})

				// Generate invoice (marked as PAID immediately)
				const invoiceNumber = `INV-${Date.now()}-${Math.random()
					.toString(36)
					.substr(2, 9)
					.toUpperCase()}`
				const invoice = await tx.invoice.create({
					data: {
						userId: userId,
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

				return { bookingId: booking.id, invoiceId: invoice.id, totalPrice, processingFee }
			})

			return c.json(
				ok(
					{
						bookingId: result.bookingId,
						invoiceId: result.invoiceId,
						totalPrice: result.totalPrice,
						processingFee: result.processingFee,
						status: BookingStatus.CONFIRMED,
						paymentStatus: PaymentStatus.PAID,
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


