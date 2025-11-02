import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { searchQuerySchema, SearchQuerySchema } from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { BookingStatus, PaymentStatus } from '@prisma/client'
import status from 'http-status'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'

// GET /admin/analytics
// Get analytics overview with total transactions, revenue, and monthly trends
export const getAnalyticsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      
      // Get date range from query (optional)
      const startDate = query.search
        ? dayjs(query.search).startOf('day').toDate()
        : dayjs().subtract(12, 'months').startOf('day').toDate()
      const endDate = dayjs().endOf('day').toDate()

      // Get all paid invoices
      const paidInvoices = await db.invoice.findMany({
        where: {
          status: PaymentStatus.PAID,
          paidAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          booking: true,
          classBooking: true,
          membershipUser: true,
        },
      })

      // Calculate total revenue
      const totalRevenue = paidInvoices.reduce(
        (sum, invoice) => sum + invoice.total,
        0,
      )

      // Count transactions by type
      const totalBookings = await db.booking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalClassBookings = await db.classBooking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalMembershipTransactions = await db.membershipUser.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      // Count confirmed/paid transactions
      const confirmedBookings = await db.booking.count({
        where: {
          status: BookingStatus.CONFIRMED,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const confirmedClassBookings = await db.classBooking.count({
        where: {
          status: BookingStatus.CONFIRMED,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      // Calculate monthly trends
      const monthlyTrends: Record<string, any> = {}

      paidInvoices.forEach((invoice) => {
        if (invoice.paidAt) {
          const monthKey = dayjs(invoice.paidAt).format('YYYY-MM')
          if (!monthlyTrends[monthKey]) {
            monthlyTrends[monthKey] = {
              month: monthKey,
              revenue: 0,
              bookingCount: 0,
              classBookingCount: 0,
              membershipCount: 0,
              totalTransactions: 0,
            }
          }
          monthlyTrends[monthKey].revenue += invoice.total
          monthlyTrends[monthKey].totalTransactions += 1

          if (invoice.bookingId) {
            monthlyTrends[monthKey].bookingCount += 1
          } else if (invoice.classBookingId) {
            monthlyTrends[monthKey].classBookingCount += 1
          } else if (invoice.membershipUserId) {
            monthlyTrends[monthKey].membershipCount += 1
          }
        }
      })

      // Convert to array and sort by month
      const monthlyTrendsArray = Object.values(monthlyTrends).sort(
        (a: any, b: any) => a.month.localeCompare(b.month),
      )

      // Calculate revenue by type
      const revenueByType = {
        bookings: paidInvoices
          .filter((inv) => inv.bookingId)
          .reduce((sum, inv) => sum + inv.total, 0),
        classBookings: paidInvoices
          .filter((inv) => inv.classBookingId)
          .reduce((sum, inv) => sum + inv.total, 0),
        memberships: paidInvoices
          .filter((inv) => inv.membershipUserId)
          .reduce((sum, inv) => sum + inv.total, 0),
      }

      // Calculate average transaction value
      const averageTransactionValue =
        paidInvoices.length > 0
          ? Math.round(totalRevenue / paidInvoices.length)
          : 0

      const analytics = {
        overview: {
          totalRevenue,
          totalTransactions: totalBookings + totalClassBookings + totalMembershipTransactions,
          totalBookings,
          totalClassBookings,
          totalMembershipTransactions,
          confirmedBookings,
          confirmedClassBookings,
          averageTransactionValue,
          paidInvoicesCount: paidInvoices.length,
        },
        revenueByType,
        monthlyTrends: monthlyTrendsArray,
        dateRange: {
          startDate: dayjs(startDate).format('YYYY-MM-DD'),
          endDate: dayjs(endDate).format('YYYY-MM-DD'),
        },
      }

      return c.json(ok(analytics), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAnalyticsHandler: ${error}`)
      throw error
    }
  },
)

// GET /admin/analytics/export/excel
// Export analytics to Excel
export const exportAnalyticsToExcelHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema

      // Get date range from query (optional)
      const startDate = query.search
        ? dayjs(query.search).startOf('day').toDate()
        : dayjs().subtract(12, 'months').startOf('day').toDate()
      const endDate = dayjs().endOf('day').toDate()

      // Get all paid invoices
      const paidInvoices = await db.invoice.findMany({
        where: {
          status: PaymentStatus.PAID,
          paidAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          booking: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
          classBooking: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
              class: {
                select: {
                  name: true,
                },
              },
            },
          },
          membershipUser: {
            include: {
              user: {
                select: {
                  name: true,
                },
              },
              membership: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      })

      // Calculate overview
      const totalRevenue = paidInvoices.reduce(
        (sum, invoice) => sum + invoice.total,
        0,
      )

      const totalBookings = await db.booking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalClassBookings = await db.classBooking.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      const totalMembershipTransactions = await db.membershipUser.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      // Calculate monthly trends
      const monthlyTrends: Record<string, any> = {}

      paidInvoices.forEach((invoice) => {
        if (invoice.paidAt) {
          const monthKey = dayjs(invoice.paidAt).format('YYYY-MM')
          if (!monthlyTrends[monthKey]) {
            monthlyTrends[monthKey] = {
              month: monthKey,
              revenue: 0,
              bookingCount: 0,
              classBookingCount: 0,
              membershipCount: 0,
              totalTransactions: 0,
            }
          }
          monthlyTrends[monthKey].revenue += invoice.total
          monthlyTrends[monthKey].totalTransactions += 1

          if (invoice.bookingId) {
            monthlyTrends[monthKey].bookingCount += 1
          } else if (invoice.classBookingId) {
            monthlyTrends[monthKey].classBookingCount += 1
          } else if (invoice.membershipUserId) {
            monthlyTrends[monthKey].membershipCount += 1
          }
        }
      })

      // Create workbook
      const workbook = XLSX.utils.book_new()

      // Sheet 1: Overview
      const overviewData = [
        { Metric: 'Total Revenue', Value: totalRevenue },
        {
          Metric: 'Total Transactions',
          Value: totalBookings + totalClassBookings + totalMembershipTransactions,
        },
        { Metric: 'Total Bookings', Value: totalBookings },
        { Metric: 'Total Class Bookings', Value: totalClassBookings },
        {
          Metric: 'Total Membership Transactions',
          Value: totalMembershipTransactions,
        },
        { Metric: 'Paid Invoices', Value: paidInvoices.length },
        {
          Metric: 'Average Transaction Value',
          Value:
            paidInvoices.length > 0
              ? Math.round(totalRevenue / paidInvoices.length)
              : 0,
        },
        {
          Metric: 'Date Range',
          Value: `${dayjs(startDate).format('YYYY-MM-DD')} to ${dayjs(endDate).format('YYYY-MM-DD')}`,
        },
      ]

      const overviewSheet = XLSX.utils.json_to_sheet(overviewData)
      overviewSheet['!cols'] = [{ wch: 30 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Overview')

      // Sheet 2: Monthly Trends
      const monthlyTrendsArray = Object.values(monthlyTrends)
        .sort((a: any, b: any) => a.month.localeCompare(b.month))
        .map((trend: any) => ({
          Month: trend.month,
          Revenue: trend.revenue,
          'Booking Count': trend.bookingCount,
          'Class Booking Count': trend.classBookingCount,
          'Membership Count': trend.membershipCount,
          'Total Transactions': trend.totalTransactions,
        }))

      const trendsSheet = XLSX.utils.json_to_sheet(monthlyTrendsArray)
      trendsSheet['!cols'] = [
        { wch: 15 }, // Month
        { wch: 15 }, // Revenue
        { wch: 15 }, // Booking Count
        { wch: 20 }, // Class Booking Count
        { wch: 18 }, // Membership Count
        { wch: 20 }, // Total Transactions
      ]
      XLSX.utils.book_append_sheet(workbook, trendsSheet, 'Monthly Trends')

      // Sheet 3: Transaction Details
      const transactionDetails = paidInvoices.map((invoice) => {
        let transactionType = 'N/A'
        let customerName = 'N/A'
        let itemName = 'N/A'

        if (invoice.bookingId && invoice.booking) {
          transactionType = 'Booking'
          customerName = invoice.booking.user?.name || 'N/A'
        } else if (invoice.classBookingId && invoice.classBooking) {
          transactionType = 'Class Booking'
          customerName = invoice.classBooking.user?.name || 'N/A'
          itemName = invoice.classBooking.class?.name || 'N/A'
        } else if (invoice.membershipUserId && invoice.membershipUser) {
          transactionType = 'Membership'
          customerName = invoice.membershipUser.user?.name || 'N/A'
          itemName = invoice.membershipUser.membership?.name || 'N/A'
        }

        return {
          'Invoice Number': invoice.number,
          'Transaction Type': transactionType,
          'Customer Name': customerName,
          'Item Name': itemName,
          'Subtotal': invoice.subtotal,
          'Processing Fee': invoice.processingFee,
          'Total': invoice.total,
          'Status': invoice.status,
          'Issued At': invoice.issuedAt
            ? dayjs(invoice.issuedAt).format('YYYY-MM-DD HH:mm:ss')
            : 'N/A',
          'Paid At': invoice.paidAt
            ? dayjs(invoice.paidAt).format('YYYY-MM-DD HH:mm:ss')
            : 'N/A',
        }
      })

      const detailsSheet = XLSX.utils.json_to_sheet(transactionDetails)
      detailsSheet['!cols'] = [
        { wch: 25 }, // Invoice Number
        { wch: 18 }, // Transaction Type
        { wch: 25 }, // Customer Name
        { wch: 30 }, // Item Name
        { wch: 15 }, // Subtotal
        { wch: 15 }, // Processing Fee
        { wch: 15 }, // Total
        { wch: 15 }, // Status
        { wch: 20 }, // Issued At
        { wch: 20 }, // Paid At
      ]
      XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Transaction Details')

      // Generate Excel buffer
      const excelBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      })

      // Generate filename with timestamp
      const filename = `analytics-${dayjs().format('YYYY-MM-DD-HHmmss')}.xlsx`

      // Set headers for file download
      c.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      c.header('Content-Disposition', `attachment; filename="${filename}"`)

      return c.body(excelBuffer)
    } catch (error) {
      c.var.logger.fatal(`Error in exportAnalyticsToExcelHandler: ${error}`)
      throw error
    }
  },
)

