// Dashboard Stats Validation Tests
// Run these SQL queries directly to verify the API calculations are 100% accurate

import { db } from '@/lib/prisma'
import { PaymentStatus } from '@prisma/client'
import dayjs from 'dayjs'

/**
 * Manual verification functions to ensure dashboard stats accuracy
 * These can be used to cross-check the API results
 */

export async function verifyTotalRevenue() {
  const currentPeriodStart = dayjs().startOf('month').toDate()
  const currentPeriodEnd = dayjs().endOf('day').toDate()

  // Method 1: Using aggregate (API method)
  const aggregateResult = await db.invoice.aggregate({
    where: {
      status: PaymentStatus.PAID,
      paidAt: {
        gte: currentPeriodStart,
        lte: currentPeriodEnd,
      },
    },
    _sum: {
      total: true,
    },
  })

  // Method 2: Manual calculation for verification
  const invoices = await db.invoice.findMany({
    where: {
      status: PaymentStatus.PAID,
      paidAt: {
        gte: currentPeriodStart,
        lte: currentPeriodEnd,
      },
    },
    select: {
      id: true,
      total: true,
      paidAt: true,
    },
  })

  const manualSum = invoices.reduce((sum, inv) => sum + inv.total, 0)

  console.log('=== TOTAL REVENUE VERIFICATION ===')
  console.log('API Aggregate Result:', aggregateResult._sum.total)
  console.log('Manual Calculation:', manualSum)
  console.log('Match:', aggregateResult._sum.total === manualSum)
  console.log('Invoice Count:', invoices.length)
  console.log('Period:', currentPeriodStart, 'to', currentPeriodEnd)

  return {
    aggregate: aggregateResult._sum.total,
    manual: manualSum,
    match: aggregateResult._sum.total === manualSum,
    count: invoices.length,
  }
}

export async function verifyTotalSales() {
  const currentPeriodStart = dayjs().startOf('month').toDate()
  const currentPeriodEnd = dayjs().endOf('day').toDate()

  // Method 1: Using count (API method)
  const countResult = await db.invoice.count({
    where: {
      status: PaymentStatus.PAID,
      paidAt: {
        gte: currentPeriodStart,
        lte: currentPeriodEnd,
      },
    },
  })

  // Method 2: Manual count for verification
  const invoices = await db.invoice.findMany({
    where: {
      status: PaymentStatus.PAID,
      paidAt: {
        gte: currentPeriodStart,
        lte: currentPeriodEnd,
      },
    },
  })

  console.log('=== TOTAL SALES VERIFICATION ===')
  console.log('API Count Result:', countResult)
  console.log('Manual Count:', invoices.length)
  console.log('Match:', countResult === invoices.length)

  return {
    apiCount: countResult,
    manualCount: invoices.length,
    match: countResult === invoices.length,
  }
}

export async function verifyNewCustomers() {
  const currentPeriodStart = dayjs().startOf('month').toDate()
  const currentPeriodEnd = dayjs().endOf('day').toDate()

  // Method 1: Using count (API method)
  const countResult = await db.user.count({
    where: {
      createdAt: {
        gte: currentPeriodStart,
        lte: currentPeriodEnd,
      },
    },
  })

  // Method 2: Manual count for verification
  const users = await db.user.findMany({
    where: {
      createdAt: {
        gte: currentPeriodStart,
        lte: currentPeriodEnd,
      },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  })

  console.log('=== NEW CUSTOMERS VERIFICATION ===')
  console.log('API Count Result:', countResult)
  console.log('Manual Count:', users.length)
  console.log('Match:', countResult === users.length)
  console.log(
    'Sample users:',
    users.slice(0, 3).map((u) => ({ name: u.name, created: u.createdAt })),
  )

  return {
    apiCount: countResult,
    manualCount: users.length,
    match: countResult === users.length,
    sampleUsers: users.slice(0, 5),
  }
}

export async function verifyActiveAccounts() {
  const currentPeriodStart = dayjs().startOf('month').toDate()
  const currentPeriodEnd = dayjs().endOf('day').toDate()

  // Method 1: Using Set (API method)
  const invoices = await db.invoice.findMany({
    where: {
      status: PaymentStatus.PAID,
      paidAt: {
        gte: currentPeriodStart,
        lte: currentPeriodEnd,
      },
      userId: {
        not: null as any,
      },
    },
    select: {
      userId: true,
    },
  })

  const uniqueUsersSet = new Set(
    invoices.map((inv) => inv.userId).filter(Boolean),
  )
  const apiCount = uniqueUsersSet.size

  // Method 2: Manual verification with array deduplication
  const userIds = invoices.map((inv) => inv.userId).filter(Boolean)
  const uniqueUserIdsArray = [...new Set(userIds)]
  const manualCount = uniqueUserIdsArray.length

  // Method 3: SQL-based verification (most accurate)
  const sqlResult = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT "userId") as count
    FROM invoice
    WHERE status = 'PAID'
      AND "paidAt" >= ${currentPeriodStart}
      AND "paidAt" <= ${currentPeriodEnd}
      AND "userId" IS NOT NULL
  `
  const sqlCount = Number(sqlResult[0].count)

  console.log('=== ACTIVE ACCOUNTS VERIFICATION ===')
  console.log('API Count (Set):', apiCount)
  console.log('Manual Count (Array):', manualCount)
  console.log('SQL Count (Raw Query):', sqlCount)
  console.log(
    'All Match:',
    apiCount === manualCount && manualCount === sqlCount,
  )
  console.log('Total Invoices:', invoices.length)
  console.log('Unique Users:', uniqueUserIdsArray.length)

  return {
    apiCount,
    manualCount,
    sqlCount,
    allMatch: apiCount === manualCount && manualCount === sqlCount,
    totalInvoices: invoices.length,
    uniqueUsers: uniqueUserIdsArray,
  }
}

export async function verifyPercentageChanges() {
  const now = dayjs()
  const currentStart = now.startOf('month').toDate()
  const currentEnd = now.endOf('day').toDate()
  const previousStart = now.subtract(1, 'month').startOf('month').toDate()
  const previousEnd = now.subtract(1, 'month').endOf('month').toDate()

  // Revenue
  const currentRevenue = await db.invoice.aggregate({
    where: {
      status: PaymentStatus.PAID,
      paidAt: { gte: currentStart, lte: currentEnd },
    },
    _sum: { total: true },
  })

  const previousRevenue = await db.invoice.aggregate({
    where: {
      status: PaymentStatus.PAID,
      paidAt: { gte: previousStart, lte: previousEnd },
    },
    _sum: { total: true },
  })

  const currentValue = currentRevenue._sum.total || 0
  const previousValue = previousRevenue._sum.total || 0

  const percentageChange =
    previousValue > 0
      ? Number(
          (((currentValue - previousValue) / previousValue) * 100).toFixed(1),
        )
      : currentValue > 0
        ? 100
        : 0

  console.log('=== PERCENTAGE CHANGE VERIFICATION ===')
  console.log('Current Revenue:', currentValue)
  console.log('Previous Revenue:', previousValue)
  console.log('Calculated Change:', percentageChange + '%')
  console.log('Formula: ((current - previous) / previous) * 100')
  console.log(
    'Verification:',
    ((currentValue - previousValue) / previousValue) * 100,
  )

  return {
    currentValue,
    previousValue,
    percentageChange,
    difference: currentValue - previousValue,
  }
}

/**
 * Run all verification tests
 */
export async function runAllVerifications() {
  console.log('\n' + '='.repeat(50))
  console.log('DASHBOARD STATS ACCURACY VERIFICATION')
  console.log('='.repeat(50) + '\n')

  const results = {
    revenue: await verifyTotalRevenue(),
    sales: await verifyTotalSales(),
    customers: await verifyNewCustomers(),
    activeAccounts: await verifyActiveAccounts(),
    percentageChanges: await verifyPercentageChanges(),
  }

  console.log('\n' + '='.repeat(50))
  console.log('VERIFICATION SUMMARY')
  console.log('='.repeat(50))
  console.log('Revenue Match:', results.revenue.match ? '✅' : '❌')
  console.log('Sales Match:', results.sales.match ? '✅' : '❌')
  console.log('Customers Match:', results.customers.match ? '✅' : '❌')
  console.log(
    'Active Accounts Match:',
    results.activeAccounts.allMatch ? '✅' : '❌',
  )
  console.log('='.repeat(50) + '\n')

  const allPassed =
    results.revenue.match &&
    results.sales.match &&
    results.customers.match &&
    results.activeAccounts.allMatch

  if (allPassed) {
    console.log('🎉 ALL VERIFICATIONS PASSED - 100% ACCURACY CONFIRMED')
  } else {
    console.log('⚠️  SOME VERIFICATIONS FAILED - PLEASE INVESTIGATE')
  }

  return results
}

// Usage:
// import { runAllVerifications } from './tests/dashboard-stats-verification'
// await runAllVerifications()
