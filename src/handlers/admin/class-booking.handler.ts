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

// GET /admin/class-bookings
// Get all class booking transactions
export const getAllClassBookingTransactionsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      const classBookings = await db.classBooking.findMany({
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
          class: {
            select: {
              id: true,
              name: true,
              description: true,
              image: true,
              startDate: true,
              endDate: true,
              startTime: true,
              endTime: true,
              price: true,
              sessions: true,
            },
          },
          details: {
            select: {
              id: true,
              date: true,
              time: true,
              price: true,
              attendance: true,
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

      return c.json(ok(classBookings), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getAllClassBookingTransactionsHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/class-bookings/:id
// Get class booking transaction detail
export const getClassBookingTransactionDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const classBooking = await db.classBooking.findUnique({
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
          class: {
            select: {
              id: true,
              name: true,
              description: true,
              content: true,
              organizerName: true,
              speakerName: true,
              image: true,
              startDate: true,
              endDate: true,
              startTime: true,
              endTime: true,
              price: true,
              sessions: true,
              capacity: true,
              remaining: true,
              maxBookingPax: true,
              gender: true,
              ageMin: true,
            },
          },
          details: {
            select: {
              id: true,
              date: true,
              time: true,
              price: true,
              attendance: true,
              createdAt: true,
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

      if (!classBooking) {
        throw new NotFoundException('Class booking not found')
      }

      return c.json(ok(classBooking), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getClassBookingTransactionDetailHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/class-bookings/:id/approve
// Approve class booking transaction
export const approveClassBookingTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const classBooking = await tx.classBooking.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!classBooking) {
          throw new NotFoundException('Class booking not found')
        }

        if (classBooking.status === BookingStatus.CONFIRMED) {
          throw new BadRequestException('Class booking is already confirmed')
        }

        if (classBooking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException(
            'Cannot approve cancelled class booking',
          )
        }

        // Update class booking status to CONFIRMED
        const updatedClassBooking = await tx.classBooking.update({
          where: { id },
          data: {
            status: BookingStatus.CONFIRMED,
          },
        })

        // Update invoice status to PAID
        if (classBooking.invoice) {
          await tx.invoice.update({
            where: { id: classBooking.invoice.id },
            data: {
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          })

          // Update payment status to PAID
          if (classBooking.invoice.payment) {
            await tx.payment.update({
              where: { id: classBooking.invoice.payment.id },
              data: {
                status: PaymentStatus.PAID,
                paidAt: new Date(),
              },
            })
          }
        }

        return updatedClassBooking
      })

      return c.json(
        ok(result, 'Class booking transaction approved successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in approveClassBookingTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/class-bookings/:id/reject
// Reject class booking transaction
export const rejectClassBookingTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const classBooking = await tx.classBooking.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!classBooking) {
          throw new NotFoundException('Class booking not found')
        }

        if (classBooking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Class booking is already cancelled')
        }

        if (classBooking.status === BookingStatus.CONFIRMED) {
          throw new BadRequestException(
            'Cannot reject confirmed class booking. Please cancel it instead.',
          )
        }

        // Update class booking status to CANCELLED
        const updatedClassBooking = await tx.classBooking.update({
          where: { id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: 'Rejected by admin',
          },
        })

        // Update invoice status to CANCELLED
        if (classBooking.invoice) {
          await tx.invoice.update({
            where: { id: classBooking.invoice.id },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          })

          // Update payment status to CANCELLED
          if (classBooking.invoice.payment) {
            await tx.payment.update({
              where: { id: classBooking.invoice.payment.id },
              data: {
                status: PaymentStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            })
          }
        }

        return updatedClassBooking
      })

      return c.json(
        ok(result, 'Class booking transaction rejected successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in rejectClassBookingTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/class-bookings/export/excel
// Export class booking transactions to Excel
export const exportClassBookingTransactionsToExcelHandler =
  factory.createHandlers(
    zValidator('query', searchQuerySchema, validateHook),
    async (c) => {
      try {
        const query = c.req.valid('query') as SearchQuerySchema
        const queryOptions = buildFindManyOptions(query, {
          defaultOrderBy: { createdAt: 'desc' },
          searchableFields: [],
        })

        const classBookings = await db.classBooking.findMany({
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
            class: {
              select: {
                id: true,
                name: true,
                description: true,
                startDate: true,
                endDate: true,
                startTime: true,
                endTime: true,
                price: true,
                sessions: true,
              },
            },
            details: {
              select: {
                id: true,
                date: true,
                time: true,
                price: true,
                attendance: true,
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

        // Transform class bookings data to Excel format
        const excelData = classBookings.map((classBooking) => {
          // Get session details
          const sessionDetails = classBooking.details
            .map(
              (d) =>
                `${dayjs(d.date).format('YYYY-MM-DD')} ${d.time} (${d.attendance ? 'Attended' : 'Not attended'})`,
            )
            .join(', ')

          return {
            'Booking ID': classBooking.id,
            'Invoice Number': classBooking.invoice?.number || 'N/A',
            'Customer Name': classBooking.user.name,
            'Customer Email': classBooking.user.email || 'N/A',
            'Customer Phone': classBooking.user.phone,
            'Class Name': classBooking.class.name,
            'Class Description': classBooking.class.description || 'N/A',
            'Class Start Date': dayjs(classBooking.class.startDate).format(
              'YYYY-MM-DD',
            ),
            'Class End Date': dayjs(classBooking.class.endDate).format(
              'YYYY-MM-DD',
            ),
            'Class Time': `${classBooking.class.startTime} - ${classBooking.class.endTime}`,
            'Total Sessions': classBooking.class.sessions,
            'Session Details': sessionDetails || 'N/A',
            'Booking Status': classBooking.status,
            'Payment Status': classBooking.invoice?.status || 'N/A',
            'Payment Method':
              classBooking.invoice?.payment?.method.name || 'N/A',
            'Total Price': classBooking.totalPrice,
            'Processing Fee': classBooking.processingFee,
            'Grand Total': classBooking.totalPrice + classBooking.processingFee,
            'Created At': dayjs(classBooking.createdAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ),
            'Cancelled At': classBooking.cancelledAt
              ? dayjs(classBooking.cancelledAt).format('YYYY-MM-DD HH:mm:ss')
              : 'N/A',
            'Cancellation Reason': classBooking.cancellationReason || 'N/A',
          }
        })

        // Create workbook and worksheet
        const worksheet = XLSX.utils.json_to_sheet(excelData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(
          workbook,
          worksheet,
          'Class Booking Transactions',
        )

        // Set column widths for better readability
        const columnWidths = [
          { wch: 30 }, // Booking ID
          { wch: 25 }, // Invoice Number
          { wch: 25 }, // Customer Name
          { wch: 30 }, // Customer Email
          { wch: 20 }, // Customer Phone
          { wch: 30 }, // Class Name
          { wch: 40 }, // Class Description
          { wch: 15 }, // Class Start Date
          { wch: 15 }, // Class End Date
          { wch: 20 }, // Class Time
          { wch: 15 }, // Total Sessions
          { wch: 50 }, // Session Details
          { wch: 15 }, // Booking Status
          { wch: 15 }, // Payment Status
          { wch: 20 }, // Payment Method
          { wch: 15 }, // Total Price
          { wch: 15 }, // Processing Fee
          { wch: 15 }, // Grand Total
          { wch: 20 }, // Created At
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
        const filename = `class-booking-transactions-${dayjs().format('YYYY-MM-DD-HHmmss')}.xlsx`

        // Set headers for file download
        c.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        c.header('Content-Disposition', `attachment; filename="${filename}"`)

        return c.body(excelBuffer)
      } catch (error) {
        c.var.logger.fatal(
          `Error in exportClassBookingTransactionsToExcelHandler: ${error}`,
        )
        throw error
      }
    },
  )

