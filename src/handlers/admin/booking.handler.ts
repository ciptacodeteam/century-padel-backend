import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, PaymentStatus } from '@prisma/client'
import status from 'http-status'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'

// GET /admin/bookings
// Get all booking transactions
export const getAllBookingTransactionsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      const bookings = await db.booking.findMany({
        ...queryOptions,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          details: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
            },
          },
          coaches: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
              bookingCoachType: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          ballboys: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                },
              },
            },
          },
          inventories: {
            include: {
              inventory: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
                    select: {
                      id: true,
                      name: true,
                      logo: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      return c.json(ok(bookings), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAllBookingTransactionsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/bookings/:id
// Get booking transaction detail
export const getBookingTransactionDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const booking = await db.booking.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
            },
          },
          details: {
            include: {
              court: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  image: true,
                },
              },
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                },
              },
            },
          },
          coaches: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                  staff: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phone: true,
                    },
                  },
                },
              },
              bookingCoachType: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          ballboys: {
            include: {
              slot: {
                select: {
                  id: true,
                  startAt: true,
                  endAt: true,
                  price: true,
                  isAvailable: true,
                  staff: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phone: true,
                    },
                  },
                },
              },
            },
          },
          inventories: {
            include: {
              inventory: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  quantity: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
                    select: {
                      id: true,
                      name: true,
                      logo: true,
                      fees: true,
                      percentage: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!booking) {
        throw new NotFoundException('Booking not found')
      }

      return c.json(ok(booking), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getBookingTransactionDetailHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/bookings/:id/approve
// Approve booking transaction
export const approveBookingTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!booking) {
          throw new NotFoundException('Booking not found')
        }

        if (booking.status === BookingStatus.CONFIRMED) {
          throw new BadRequestException('Booking is already confirmed')
        }

        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Cannot approve cancelled booking')
        }

        // Update booking status to CONFIRMED
        const updatedBooking = await tx.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CONFIRMED,
            holdExpiresAt: null, // Clear hold expiry
          },
        })

        // Update invoice status to PAID
        if (booking.invoice) {
          await tx.invoice.update({
            where: { id: booking.invoice.id },
            data: {
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          })

          // Update payment status to PAID
          if (booking.invoice.payment) {
            await tx.payment.update({
              where: { id: booking.invoice.payment.id },
              data: {
                status: PaymentStatus.PAID,
                paidAt: new Date(),
              },
            })
          }
        }

        return updatedBooking
      })

      return c.json(
        ok(result, 'Booking transaction approved successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in approveBookingTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/bookings/:id/reject
// Reject booking transaction
export const rejectBookingTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!booking) {
          throw new NotFoundException('Booking not found')
        }

        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Booking is already cancelled')
        }

        if (booking.status === BookingStatus.CONFIRMED) {
          throw new BadRequestException(
            'Cannot reject confirmed booking. Please cancel it instead.',
          )
        }

        // Update booking status to CANCELLED
        const updatedBooking = await tx.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: 'Rejected by admin',
          },
        })

        // Update invoice status to CANCELLED
        if (booking.invoice) {
          await tx.invoice.update({
            where: { id: booking.invoice.id },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          })

          // Update payment status to CANCELLED
          if (booking.invoice.payment) {
            await tx.payment.update({
              where: { id: booking.invoice.payment.id },
              data: {
                status: PaymentStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            })
          }
        }

        return updatedBooking
      })

      return c.json(
        ok(result, 'Booking transaction rejected successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in rejectBookingTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/bookings/export/excel
// Export booking transactions to Excel
export const exportBookingTransactionsToExcelHandler =
  factory.createHandlers(
    zValidator('query', searchQuerySchema, validateHook),
    async (c) => {
      try {
        const query = c.req.valid('query') as SearchQuerySchema
        const queryOptions = buildFindManyOptions(query, {
          defaultOrderBy: { createdAt: 'desc' },
          searchableFields: [],
        })

        const bookings = await db.booking.findMany({
          ...queryOptions,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
            details: {
              include: {
                court: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                slot: {
                  select: {
                    id: true,
                    startAt: true,
                    endAt: true,
                    price: true,
                  },
                },
              },
            },
            coaches: {
              include: {
                slot: {
                  select: {
                    id: true,
                    startAt: true,
                    endAt: true,
                    price: true,
                  },
                },
                bookingCoachType: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            ballboys: {
              include: {
                slot: {
                  select: {
                    id: true,
                    startAt: true,
                    endAt: true,
                    price: true,
                  },
                },
              },
            },
            inventories: {
              include: {
                inventory: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            invoice: {
              include: {
                payment: {
                  include: {
                    method: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })

        // Transform bookings data to Excel format
        const excelData = bookings.map((booking) => {
          // Get courts info
          const courts = booking.details
            .map((d) => d.court?.name || 'N/A')
            .join(', ')
          const courtSlots = booking.details
            .map(
              (d) =>
                `${dayjs(d.slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(d.slot.endAt).format('HH:mm')}`,
            )
            .join(', ')

          // Get coaches info
          const coaches = booking.coaches
            .map((c) => c.bookingCoachType.name)
            .join(', ')
          const coachSlots = booking.coaches
            .map(
              (c) =>
                `${dayjs(c.slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(c.slot.endAt).format('HH:mm')}`,
            )
            .join(', ')

          // Get ballboys info
          const ballboySlots = booking.ballboys
            .map(
              (b) =>
                `${dayjs(b.slot.startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(b.slot.endAt).format('HH:mm')}`,
            )
            .join(', ')

          // Get inventories info
          const inventories = booking.inventories
            .map((i) => `${i.inventory.name} (x${i.quantity})`)
            .join(', ')

          return {
            'Booking ID': booking.id,
            'Invoice Number': booking.invoice?.number || 'N/A',
            'Customer Name': booking.user.name,
            'Customer Email': booking.user.email || 'N/A',
            'Customer Phone': booking.user.phone,
            'Booking Status': booking.status,
            'Payment Status': booking.invoice?.status || 'N/A',
            'Payment Method': booking.invoice?.payment?.method.name || 'N/A',
            Courts: courts || 'N/A',
            'Court Slots': courtSlots || 'N/A',
            Coaches: coaches || 'N/A',
            'Coach Slots': coachSlots || 'N/A',
            'Ballboy Slots': ballboySlots || 'N/A',
            Inventories: inventories || 'N/A',
            'Total Price': booking.totalPrice,
            'Processing Fee': booking.processingFee,
            'Grand Total': booking.totalPrice + booking.processingFee,
            'Created At': dayjs(booking.createdAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ),
            'Hold Expires At': booking.holdExpiresAt
              ? dayjs(booking.holdExpiresAt).format('YYYY-MM-DD HH:mm:ss')
              : 'N/A',
            'Cancelled At': booking.cancelledAt
              ? dayjs(booking.cancelledAt).format('YYYY-MM-DD HH:mm:ss')
              : 'N/A',
            'Cancellation Reason': booking.cancellationReason || 'N/A',
          }
        })

        // Create workbook and worksheet
        const worksheet = XLSX.utils.json_to_sheet(excelData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Booking Transactions')

        // Set column widths for better readability
        const columnWidths = [
          { wch: 30 }, // Booking ID
          { wch: 25 }, // Invoice Number
          { wch: 25 }, // Customer Name
          { wch: 30 }, // Customer Email
          { wch: 20 }, // Customer Phone
          { wch: 15 }, // Booking Status
          { wch: 15 }, // Payment Status
          { wch: 20 }, // Payment Method
          { wch: 30 }, // Courts
          { wch: 40 }, // Court Slots
          { wch: 30 }, // Coaches
          { wch: 40 }, // Coach Slots
          { wch: 40 }, // Ballboy Slots
          { wch: 30 }, // Inventories
          { wch: 15 }, // Total Price
          { wch: 15 }, // Processing Fee
          { wch: 15 }, // Grand Total
          { wch: 20 }, // Created At
          { wch: 20 }, // Hold Expires At
          { wch: 20 }, // Cancelled At
          { wch: 30 }, // Cancellation Reason
        ]
        worksheet['!cols'] = columnWidths

        // Generate Excel buffer
        const excelBuffer = XLSX.write(workbook, {
          type: 'buffer',
          bookType: 'xlsx',
        })

        // Generate filename with timestamp
        const filename = `booking-transactions-${dayjs().format('YYYY-MM-DD-HHmmss')}.xlsx`

        // Set headers for file download
        c.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        c.header('Content-Disposition', `attachment; filename="${filename}"`)

        return c.body(excelBuffer)
      } catch (error) {
        c.var.logger.fatal(
          `Error in exportBookingTransactionsToExcelHandler: ${error}`,
        )
        throw error
      }
    },
  )

