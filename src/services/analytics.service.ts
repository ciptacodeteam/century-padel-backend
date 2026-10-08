import { db } from '@/lib/prisma'
import { BookingStatus } from '@prisma/client'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { getFileUrl } from './upload.service'
import {
  getRevenueInvoices,
  invoiceRevenue,
  revenueBooking,
  invoiceSource,
  revenuePaidAt,
  revenueInvoiceWhere,
} from './revenue.service'
import {
  bookingPaymentTypeWhere,
  type BookingPaymentType,
} from './booking-payment-type.service'

/** All paid purchases are counted once by invoice, even without a Payment row. */
export async function getIncomeBySourceAnalytics(
  startDate: Date,
  endDate: Date,
  source?: 'cashier' | 'online',
) {
  const invoices = await getRevenueInvoices(startDate, endDate, source)
  const bySource: Record<
    string,
    {
      count: number
      total: number
      processingFee: number
      refunds: number
      cancellations: number
      transactions: unknown[]
    }
  > = {}
  let totalGrossAmount = 0,
    totalProcessingFees = 0,
    totalRefunds = 0,
    totalCancellations = 0,
    totalNetAmount = 0
  let cashierIncome = 0,
    onlineIncome = 0,
    unknownIncome = 0
  for (const invoice of invoices) {
    const amounts = invoiceRevenue(invoice)
    const channel = invoiceSource(invoice)
    // Product breakdown stays mutually exclusive; the channel totals below
    // include membership, court/add-on and class purchases alike.
    const key = invoice.membershipUserId
      ? 'Membership'
      : invoice.classBookingId
        ? 'Class Bookings'
        : channel === 'cashier'
          ? 'Cashier'
          : channel === 'online'
            ? 'Online'
            : 'Unknown'
    const group = (bySource[key] ??= {
      count: 0,
      total: 0,
      processingFee: 0,
      refunds: 0,
      cancellations: 0,
      transactions: [],
    })
    group.count++
    group.total += amounts.net
    group.processingFee += amounts.fees
    group.refunds += amounts.refund
    group.cancellations += amounts.cancellation
    group.transactions.push({
      id: invoice.id,
      invoiceNumber: invoice.number,
      customerName: invoice.user.name,
      bookingId: invoice.bookingId,
      membershipUserId: invoice.membershipUserId,
      classBookingId: invoice.classBookingId,
      amount: amounts.gross,
      processingFee: amounts.fees,
      refundAmount: amounts.refund,
      cancellationAmount: amounts.cancellation,
      netAmount: amounts.net,
      date: revenuePaidAt(invoice),
      source: channel,
    })
    totalGrossAmount += amounts.gross
    totalProcessingFees += amounts.fees
    totalRefunds += amounts.refund
    totalCancellations += amounts.cancellation
    totalNetAmount += amounts.net
    if (channel === 'cashier') cashierIncome += amounts.net
    else if (channel === 'online') onlineIncome += amounts.net
    else unknownIncome += amounts.net
  }
  return {
    summary: {
      totalIncome: totalNetAmount,
      totalGrossAmount,
      totalProcessingFees,
      totalRefunds,
      totalCancellations,
      totalNetAmount,
      onlineBookingIncome: bySource.Online?.total ?? 0,
      cashierBookingIncome: bySource.Cashier?.total ?? 0,
      classBookingIncome: bySource['Class Bookings']?.total ?? 0,
      membershipIncome: bySource.Membership?.total ?? 0,
      otherIncome: bySource.Unknown?.total ?? 0,
      cashierIncome,
      onlineIncome,
      unknownIncome,
      totalTransactions: invoices.length,
    },
    bySource,
    dateRange: { startDate, endDate },
  }
}

export async function getPaymentMethodAnalytics(
  startDate: Date,
  endDate: Date,
  source?: 'cashier' | 'online',
) {
  const invoices = await getRevenueInvoices(startDate, endDate, source)
  const groups = new Map<
    string,
    {
      method: { id: string; name: string; logo: string | null }
      count: number
      total: number
      processingFee: number
      refunds: number
      cancellations: number
      netAmount: number
      transactions: unknown[]
    }
  >()
  let totalAmount = 0,
    totalProcessingFees = 0,
    totalRefunds = 0,
    totalCancellations = 0,
    netRevenue = 0
  for (const invoice of invoices) {
    const amounts = invoiceRevenue(invoice)
    const channel = invoiceSource(invoice)
    const method = invoice.payment?.method
    // Legacy and new CASHIER payments share one group, not duplicate cards.
    const cashierMethod =
      method?.channel === 'CASHIER' || (!method && channel === 'cashier')
    const key = cashierMethod ? 'cashier' : (method?.id ?? 'unknown')
    if (!groups.has(key))
      groups.set(key, {
        method: {
          id: key,
          name: cashierMethod
            ? 'Kasir'
            : (method?.name ?? 'Metode belum tercatat'),
          logo:
            !cashierMethod && method?.logo
              ? await getFileUrl(method.logo)
              : null,
        },
        count: 0,
        total: 0,
        processingFee: 0,
        refunds: 0,
        cancellations: 0,
        netAmount: 0,
        transactions: [],
      })
    const group = groups.get(key)!
    group.count++
    group.total += amounts.gross
    group.processingFee += amounts.fees
    group.refunds += amounts.refund
    group.cancellations += amounts.cancellation
    group.netAmount += amounts.net
    group.transactions.push({
      id: invoice.id,
      invoiceNumber: invoice.number,
      customerName: invoice.user.name,
      type: invoice.membershipUserId
        ? 'Membership'
        : invoice.classBookingId
          ? 'Class'
          : 'Booking',
      source: channel,
      amount: amounts.gross,
      processingFee: amounts.fees,
      refundAmount: amounts.refund,
      cancellationAmount: amounts.cancellation,
      netAmount: amounts.net,
      date: revenuePaidAt(invoice),
      legacyPayment: !invoice.payment,
    })
    totalAmount += amounts.gross
    totalProcessingFees += amounts.fees
    totalRefunds += amounts.refund
    totalCancellations += amounts.cancellation
    netRevenue += amounts.net
  }
  const methods = [...groups.values()]
    .map((group) => ({
      ...group,
      percentage: totalAmount ? (group.total / totalAmount) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)
  return {
    summary: {
      totalAmount,
      totalProcessingFees,
      totalRefunds,
      totalCancellations,
      netRevenue,
      totalTransactions: invoices.length,
      methodCount: methods.length,
    },
    methods,
    dateRange: { startDate, endDate },
  }
}

/**
 * Export data to Excel
 * Can export: Courts, Inventory, Coach Bookings
 */
export async function exportDataToExcel(
  dataType: 'courts' | 'inventory' | 'coach-bookings' | 'bookings',
  startDate?: Date,
  endDate?: Date,
  source?: 'cashier' | 'online',
  paymentType?: BookingPaymentType,
): Promise<Buffer> {
  const workbook = XLSX.utils.book_new()

  if (dataType === 'courts') {
    const courts = await db.court.findMany({
      include: {
        costSchedules: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    const courtData = courts.map((court) => ({
      'Court ID': court.id,
      'Court Name': court.name,
      Description: court.description || 'N/A',
      'Is Active': court.isActive ? 'Yes' : 'No',
      'Current Cost (IDR)': court.costSchedules[0]?.price || 'N/A',
      'Created At': dayjs(court.createdAt).format('YYYY-MM-DD HH:mm'),
    }))

    const ws = XLSX.utils.json_to_sheet(courtData)
    XLSX.utils.book_append_sheet(workbook, ws, 'Courts')
  } else if (dataType === 'inventory') {
    const inventory = await db.inventory.findMany()

    const inventoryData = inventory.map((item) => ({
      'Item ID': item.id,
      'Item Name': item.name,
      Description: item.description || 'N/A',
      'Stock Quantity': item.quantity,
      'Unit Price (IDR)': item.price,
      'Total Value (IDR)': item.quantity * item.price,
      'Is Active': item.isActive ? 'Yes' : 'No',
      'Created At': dayjs(item.createdAt).format('YYYY-MM-DD HH:mm'),
    }))

    const ws = XLSX.utils.json_to_sheet(inventoryData)
    XLSX.utils.book_append_sheet(workbook, ws, 'Inventory')
  } else if (dataType === 'coach-bookings') {
    const coachBookings = await db.bookingCoach.findMany({
      where:
        startDate && endDate
          ? { createdAt: { gte: startDate, lte: endDate } }
          : undefined,
      include: {
        booking: {
          select: {
            id: true,
            totalPrice: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
          },
        },
        slot: {
          select: {
            id: true,
            startAt: true,
            endAt: true,
            staffId: true,
          },
        },
        bookingCoachType: { select: { name: true } },
      },
    })

    // Get staff details (coaches)
    const staffIds = coachBookings
      .map((cb) => cb.slot?.staffId)
      .filter(Boolean) as string[]

    const staffDetails = await db.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    })

    const staffMap = new Map(staffDetails.map((s) => [s.id, s.name]))

    const coachBookingData = coachBookings.map((cb) => ({
      'Booking ID': cb.booking?.id || 'N/A',
      Coach: cb.slot?.staffId ? staffMap.get(cb.slot.staffId) || 'N/A' : 'N/A',
      'Coach Type': cb.bookingCoachType?.name || 'N/A',
      'Customer Name': cb.booking?.user?.name || 'N/A',
      'Customer Email': cb.booking?.user?.email || 'N/A',
      Date: cb.slot?.startAt
        ? dayjs(cb.slot.startAt).format('YYYY-MM-DD')
        : 'N/A',
      'Start Time': cb.slot?.startAt
        ? dayjs(cb.slot.startAt).format('HH:mm')
        : 'N/A',
      'End Time': cb.slot?.endAt ? dayjs(cb.slot.endAt).format('HH:mm') : 'N/A',
      'Total Amount (IDR)': cb.price || 0,
      'Booking Date': cb.booking?.createdAt
        ? dayjs(cb.booking.createdAt).format('YYYY-MM-DD HH:mm')
        : 'N/A',
    }))

    const ws = XLSX.utils.json_to_sheet(coachBookingData)
    XLSX.utils.book_append_sheet(workbook, ws, 'Coach Bookings')
  } else if (dataType === 'bookings') {
    const where: any =
      startDate && endDate
        ? { createdAt: { gte: startDate, lte: endDate } }
        : {}
    if (source === 'cashier') {
      where.cashierId = { not: null }
    } else if (source === 'online') {
      where.cashierId = null
    }
    if (paymentType) {
      Object.assign(where, bookingPaymentTypeWhere(paymentType))
    }

    const bookings = await db.booking.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        cashier: { select: { id: true, name: true, email: true } },
        details: {
          include: {
            court: { select: { id: true, name: true } },
            slot: { select: { startAt: true, endAt: true, price: true } },
          },
        },
        coaches: { select: { id: true } },
        ballboys: { select: { id: true } },
        inventories: {
          include: { inventory: { select: { id: true, name: true } } },
        },
        invoice: {
          select: {
            number: true,
            status: true,
            subtotal: true,
            processingFee: true,
            total: true,
            paidAt: true,
            payment: { select: { method: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const bookingsData = bookings.map((b) => {
      const courts = Array.from(
        new Set((b.details || []).map((d) => d.court?.name).filter(Boolean)),
      )
      const slots = (b.details || [])
        .map((d) =>
          d.slot?.startAt && d.slot?.endAt
            ? `${dayjs(d.slot.startAt).format('YYYY-MM-DD HH:mm')}-${dayjs(d.slot.endAt).format('HH:mm')}`
            : 'N/A',
        )
        .filter((s) => s !== 'N/A')
      const courtPriceSum = (b.details || []).reduce(
        (sum, d) => sum + (d.slot?.price || 0),
        0,
      )
      const inventoryItems = (b.inventories || [])
        .map((i) => i.inventory?.name)
        .filter(Boolean)
      const source = b.cashier ? 'Cashier' : 'Online'
      const usesMembership =
        b.details.some((detail) => detail.membershipUserId) ||
        (b.details.length > 0 && b.courtNormalPrice === 0)

      const netAmount =
        (b.invoice?.total || 0) - (b.invoice?.processingFee || 0)
      return {
        'Booking ID': b.id,
        'Customer ID': b.user?.id || 'N/A',
        Source: source,
        'Payment Type': usesMembership ? 'Membership' : 'Regular',
        Status: b.status,
        'Customer Name': b.user?.name || 'N/A',
        'Customer Email': b.user?.email || 'N/A',
        'Customer Phone': b.user?.phone || 'N/A',
        'Cashier Name': b.cashier?.name || 'N/A',
        'Cashier ID': b.cashier?.id || 'N/A',
        'Created At': dayjs(b.createdAt).format('YYYY-MM-DD HH:mm'),
        'Invoice Number': b.invoice?.number || 'N/A',
        'Invoice Status': b.invoice?.status || 'N/A',
        'Subtotal (IDR)': b.invoice?.subtotal || 0,
        'Processing Fee (IDR)': b.invoice?.processingFee || 0,
        'Total Amount (IDR)': b.invoice?.total || 0,
        'Net Amount (IDR)': netAmount,
        'Paid At': b.invoice?.paidAt
          ? dayjs(b.invoice.paidAt).format('YYYY-MM-DD HH:mm')
          : 'N/A',
        'Payment Method': b.invoice?.payment?.method?.name || 'N/A',
        Courts: courts.join('; '),
        Slots: slots.join('; '),
        'Court Price Sum (IDR)': courtPriceSum,
        'Coach Count': (b.coaches || []).length,
        'Ballboy Count': (b.ballboys || []).length,
        'Inventory Items': inventoryItems.join('; '),
      }
    })

    const ws = XLSX.utils.json_to_sheet(bookingsData)
    ws['!cols'] = [
      { wch: 24 }, // Booking ID
      { wch: 18 }, // Customer ID
      { wch: 10 }, // Source
      { wch: 14 }, // Payment Type
      { wch: 12 }, // Status
      { wch: 20 }, // Customer Name
      { wch: 24 }, // Customer Email
      { wch: 18 }, // Customer Phone
      { wch: 20 }, // Cashier Name
      { wch: 18 }, // Cashier ID
      { wch: 20 }, // Created At
      { wch: 20 }, // Invoice Number
      { wch: 14 }, // Invoice Status
      { wch: 16 }, // Subtotal
      { wch: 18 }, // Processing Fee
      { wch: 18 }, // Total Amount
      { wch: 18 }, // Net Amount
      { wch: 20 }, // Paid At
      { wch: 16 }, // Payment Method
      { wch: 24 }, // Courts
      { wch: 36 }, // Slots
      { wch: 18 }, // Court Price Sum
      { wch: 14 }, // Coach Count
      { wch: 14 }, // Ballboy Count
      { wch: 30 }, // Inventory Items
    ]
    XLSX.utils.book_append_sheet(workbook, ws, 'Bookings')
  }

  // Convert to buffer
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })
  return buffer as Buffer
}

/**
 * Get comprehensive business analytics
 * Includes: Courts, Coaches, Inventory, Memberships
 */
export async function getBusinessAnalytics(startDate: Date, endDate: Date) {
  // Court statistics
  const totalCourts = await db.court.count()
  const bookedCourts = await db.bookingDetail.findMany({
    where: {
      cancelledAt: null,
      createdAt: { gte: startDate, lte: endDate },
    },
    distinct: ['courtId'],
    select: { courtId: true },
  })

  // Top hours and days analytics
  // Get all booking slots in the period
  const bookingSlots = await db.bookingDetail.findMany({
    where: {
      cancelledAt: null,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      slot: {
        select: {
          startAt: true,
        },
      },
    },
  })

  // Count frequency by hour and day
  const hourCounts: Record<string, number> = {}
  const dayCounts: Record<string, number> = {}
  for (const bd of bookingSlots) {
    const startAt = bd.slot?.startAt
    if (startAt) {
      const dateObj = new Date(startAt)
      const hour = dateObj.getHours().toString().padStart(2, '0') + ':00'
      const day = dateObj.toLocaleDateString('en-US', { weekday: 'long' })
      hourCounts[hour] = (hourCounts[hour] || 0) + 1
      dayCounts[day] = (dayCounts[day] || 0) + 1
    }
  }
  // Sort and get top 5 for each
  const topHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour, count]) => ({ hour, count }))
  const topDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([day, count]) => ({ day, count }))

  // Coach statistics (Staff with coach role)
  const totalStaff = await db.staff.count()
  const activeCoaches = await db.bookingCoach.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    select: { slot: { select: { staffId: true } } },
  })

  const uniqueCoachIds = new Set(
    activeCoaches.map((bc) => bc.slot?.staffId).filter(Boolean),
  )

  const coachSessionCount = await db.bookingCoach.count({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  // Inventory statistics
  const totalInventoryItems = await db.inventory.count()
  const usedInventory = await db.bookingInventory.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    distinct: ['inventoryId'],
    select: { inventoryId: true },
  })

  const totalInventoryValue = await db.inventory.aggregate({
    _sum: { price: true },
  })

  // Membership statistics
  const totalMemberships = await db.membership.count()
  const activeMemberships = await db.membershipUser.count({
    where: {
      endDate: { gt: new Date() },
    },
  })

  const newMemberships = await db.membershipUser.count({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  // Booking statistics
  const totalBookings = await db.booking.count({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  const confirmedBookings = await db.booking.count({
    where: {
      status: BookingStatus.CONFIRMED,
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  // Revenue
  const revenueInvoices = await db.invoice.findMany({
    where: revenueInvoiceWhere(startDate, endDate),
    select: {
      status: true,
      total: true,
      processingFee: true,
      booking: revenueBooking,
      promoDiscountAmount: true,
      payment: { select: { meta: true, status: true } },
    },
  })

  const grossRevenue = revenueInvoices.reduce(
    (sum, invoice) => sum + invoice.total,
    0,
  )
  const processingFees = revenueInvoices.reduce(
    (sum, invoice) => sum + invoice.processingFee,
    0,
  )
  const refunds = revenueInvoices.reduce(
    (sum, invoice) => sum + invoiceRevenue(invoice).refund,
    0,
  )
  const netRevenue = revenueInvoices.reduce(
    (sum, invoice) => sum + invoiceRevenue(invoice).net,
    0,
  )

  // Most booked courts
  const topCourts = await db.bookingDetail.groupBy({
    by: ['courtId'],
    where: {
      cancelledAt: null,
      createdAt: { gte: startDate, lte: endDate },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  })

  const topCourtDetails = await Promise.all(
    topCourts.map(async (tc) => {
      const court = await db.court.findUnique({
        where: { id: tc.courtId || '' },
        select: { id: true, name: true },
      })
      return { court, bookings: tc._count.id }
    }),
  )

  // Top coaches
  const topCoachesData: Record<string, number> = {}
  for (const bc of activeCoaches) {
    const staffId = bc.slot?.staffId
    if (staffId) {
      topCoachesData[staffId] = (topCoachesData[staffId] || 0) + 1
    }
  }

  const topCoachIds = Object.entries(topCoachesData)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id)

  const topCoachStaff = await db.staff.findMany({
    where: { id: { in: topCoachIds } },
    select: { id: true, name: true },
  })

  const topCoachDetails = topCoachStaff.map((coach) => ({
    coach: { id: coach.id, name: coach.name },
    sessions: topCoachesData[coach.id] || 0,
  }))

  return {
    courts: {
      total: totalCourts,
      booked: bookedCourts.length,
      utilization:
        totalCourts > 0
          ? ((bookedCourts.length / totalCourts) * 100).toFixed(2) + '%'
          : '0%',
      topCourts: topCourtDetails,
      topHours,
      topDays,
    },
    coaches: {
      total: totalStaff,
      active: uniqueCoachIds.size,
      totalSessions: coachSessionCount,
      topCoaches: topCoachDetails,
    },
    inventory: {
      totalItems: totalInventoryItems,
      itemsUsed: usedInventory.length,
      totalValue: totalInventoryValue._sum.price || 0,
      utilizationRate:
        totalInventoryItems > 0
          ? ((usedInventory.length / totalInventoryItems) * 100).toFixed(2) +
            '%'
          : '0%',
    },
    memberships: {
      total: totalMemberships,
      active: activeMemberships,
      newInPeriod: newMemberships,
      activePercentage:
        totalMemberships > 0
          ? ((activeMemberships / totalMemberships) * 100).toFixed(2) + '%'
          : '0%',
    },
    bookings: {
      total: totalBookings,
      confirmed: confirmedBookings,
      confirmationRate:
        totalBookings > 0
          ? ((confirmedBookings / totalBookings) * 100).toFixed(2) + '%'
          : '0%',
    },
    revenue: {
      total: netRevenue,
      gross: grossRevenue,
      processingFees,
      refunds,
      net: netRevenue,
      transactions: revenueInvoices.length,
      avgPerTransaction:
        revenueInvoices.length > 0
          ? (netRevenue / revenueInvoices.length).toFixed(2)
          : '0',
    },
    dateRange: { startDate, endDate },
  }
}
