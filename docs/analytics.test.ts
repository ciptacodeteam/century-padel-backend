/**
 * Analytics APIs Integration Tests
 *
 * These are manual integration tests to validate the analytics endpoints
 * Run against a local or staging environment with test data
 *
 * Prerequisites:
 * 1. Backend running (bun run dev or Docker)
 * 2. Database populated with test data
 * 3. Valid admin authentication token
 */

// Test Configuration
const BASE_URL = 'http://localhost:8787'
const AUTH_TOKEN = 'your_admin_token_here'

// Helper: Make API request
async function makeRequest(endpoint: string, query?: Record<string, string>) {
  const url = new URL(`${BASE_URL}${endpoint}`)

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
  })

  return {
    status: response.status,
    data: await response.json(),
  }
}

// Helper: Download file
async function downloadFile(
  endpoint: string,
  filename: string,
  query?: Record<string, string>,
) {
  const url = new URL(`${BASE_URL}${endpoint}`)

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`)
  }

  // In Node.js environment
  if (typeof window === 'undefined') {
    const buffer = await response.arrayBuffer()
    console.log(`✓ Downloaded ${filename} (${buffer.byteLength} bytes)`)
  } else {
    // In browser environment
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    console.log(`✓ Downloaded ${filename}`)
  }
}

// Test 1: Income by Source
async function testIncomeBySource() {
  console.log('\n=== TEST 1: Income by Source ===')

  try {
    const oneMonthAgo = new Date()
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30)
    const today = new Date()

    const result = await makeRequest('/admin/analytics/income-by-source', {
      startDate: oneMonthAgo.toISOString(),
      endDate: today.toISOString(),
    })

    if (result.status === 200 && !result.data.error) {
      console.log('✓ PASS: Income by Source endpoint')
      console.log(`  - Total Income: ${result.data.data.summary.totalIncome}`)
      console.log(
        `  - Online Bookings: ${result.data.data.summary.onlineBookingIncome}`,
      )
      console.log(
        `  - Cashier Bookings: ${result.data.data.summary.cashierBookingIncome}`,
      )
      console.log(
        `  - Class Bookings: ${result.data.data.summary.classBookingIncome}`,
      )
      console.log(
        `  - Membership: ${result.data.data.summary.membershipIncome}`,
      )
      console.log(
        `  - Total Transactions: ${result.data.data.summary.totalTransactions}`,
      )
      return true
    } else {
      console.log('✗ FAIL: Income by Source endpoint')
      console.log(`  Error: ${result.data.message}`)
      return false
    }
  } catch (error) {
    console.log(`✗ ERROR: ${error}`)
    return false
  }
}

// Test 2: Payment Methods
async function testPaymentMethods() {
  console.log('\n=== TEST 2: Payment Methods ===')

  try {
    const result = await makeRequest('/admin/analytics/payment-methods')

    if (result.status === 200 && !result.data.error) {
      console.log('✓ PASS: Payment Methods endpoint')
      console.log(`  - Total Amount: ${result.data.data.summary.totalAmount}`)
      console.log(
        `  - Total Transactions: ${result.data.data.summary.totalTransactions}`,
      )
      console.log(`  - Method Count: ${result.data.data.summary.methodCount}`)

      Object.entries(result.data.data.methods).forEach(
        ([method, stats]: [string, any]) => {
          console.log(
            `  - ${method}: ${stats.count} transactions (${stats.percentage.toFixed(2)}%)`,
          )
        },
      )

      return true
    } else {
      console.log('✗ FAIL: Payment Methods endpoint')
      console.log(`  Error: ${result.data.message}`)
      return false
    }
  } catch (error) {
    console.log(`✗ ERROR: ${error}`)
    return false
  }
}

// Test 3: Business Insights
async function testBusinessInsights() {
  console.log('\n=== TEST 3: Business Insights ===')

  try {
    const result = await makeRequest('/admin/analytics/business-insights')

    if (result.status === 200 && !result.data.error) {
      console.log('✓ PASS: Business Insights endpoint')

      const { courts, coaches, inventory, memberships, bookings, revenue } =
        result.data.data

      console.log('  Courts:')
      console.log(`    - Total: ${courts.total}`)
      console.log(`    - Booked: ${courts.booked}`)
      console.log(`    - Utilization: ${courts.utilization}`)

      console.log('  Coaches:')
      console.log(`    - Total: ${coaches.total}`)
      console.log(`    - Active: ${coaches.active}`)
      console.log(`    - Sessions: ${coaches.totalSessions}`)

      console.log('  Inventory:')
      console.log(`    - Total Items: ${inventory.totalItems}`)
      console.log(`    - Used: ${inventory.itemsUsed}`)
      console.log(`    - Total Value: ${inventory.totalValue}`)

      console.log('  Memberships:')
      console.log(`    - Total: ${memberships.total}`)
      console.log(`    - Active: ${memberships.active}`)
      console.log(`    - New: ${memberships.newInPeriod}`)

      console.log('  Bookings:')
      console.log(`    - Total: ${bookings.total}`)
      console.log(`    - Confirmed: ${bookings.confirmed}`)
      console.log(`    - Rate: ${bookings.confirmationRate}`)

      console.log('  Revenue:')
      console.log(`    - Total: ${revenue.total}`)
      console.log(`    - Transactions: ${revenue.transactions}`)
      console.log(`    - Avg: ${revenue.avgPerTransaction}`)

      return true
    } else {
      console.log('✗ FAIL: Business Insights endpoint')
      console.log(`  Error: ${result.data.message}`)
      return false
    }
  } catch (error) {
    console.log(`✗ ERROR: ${error}`)
    return false
  }
}

// Test 4: Export Courts
async function testExportCourts() {
  console.log('\n=== TEST 4: Export Courts ===')

  try {
    await downloadFile('/admin/analytics/export/bulk-data', 'courts.xlsx', {
      type: 'courts',
    })
    console.log('✓ PASS: Courts export')
    return true
  } catch (error) {
    console.log(`✗ FAIL: Courts export`)
    console.log(`  Error: ${error}`)
    return false
  }
}

// Test 5: Export Inventory
async function testExportInventory() {
  console.log('\n=== TEST 5: Export Inventory ===')

  try {
    await downloadFile('/admin/analytics/export/bulk-data', 'inventory.xlsx', {
      type: 'inventory',
    })
    console.log('✓ PASS: Inventory export')
    return true
  } catch (error) {
    console.log(`✗ FAIL: Inventory export`)
    console.log(`  Error: ${error}`)
    return false
  }
}

// Test 6: Export Coach Bookings
async function testExportCoachBookings() {
  console.log('\n=== TEST 6: Export Coach Bookings ===')

  try {
    const oneMonthAgo = new Date()
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30)
    const today = new Date()

    await downloadFile(
      '/admin/analytics/export/bulk-data',
      'coach-bookings.xlsx',
      {
        type: 'coach-bookings',
        startDate: oneMonthAgo.toISOString(),
        endDate: today.toISOString(),
      },
    )
    console.log('✓ PASS: Coach Bookings export')
    return true
  } catch (error) {
    console.log(`✗ FAIL: Coach Bookings export`)
    console.log(`  Error: ${error}`)
    return false
  }
}

// Test 7: Invalid Date Format
async function testInvalidDateFormat() {
  console.log('\n=== TEST 7: Invalid Date Format ===')

  try {
    const result = await makeRequest('/admin/analytics/income-by-source', {
      startDate: 'invalid-date',
    })

    if (result.status !== 200) {
      console.log('✓ PASS: Properly rejected invalid date')
      return true
    } else {
      console.log('✗ FAIL: Should reject invalid date')
      return false
    }
  } catch (error) {
    console.log(`✗ ERROR: ${error}`)
    return false
  }
}

// Test 8: Missing Auth Token
async function testMissingAuth() {
  console.log('\n=== TEST 8: Missing Auth Token ===')

  try {
    const response = await fetch(`${BASE_URL}/admin/analytics/income-by-source`)

    if (response.status === 401) {
      console.log('✓ PASS: Properly rejected unauthenticated request')
      return true
    } else {
      console.log('✗ FAIL: Should reject unauthenticated request')
      return false
    }
  } catch (error) {
    console.log(`✗ ERROR: ${error}`)
    return false
  }
}

// Run all tests
async function runAllTests() {
  console.log('====================================')
  console.log('  Analytics APIs Integration Tests')
  console.log('====================================')
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Auth Token: ${AUTH_TOKEN.substring(0, 20)}...`)

  const results: Record<string, boolean> = {}

  results['Income by Source'] = await testIncomeBySource()
  results['Payment Methods'] = await testPaymentMethods()
  results['Business Insights'] = await testBusinessInsights()
  results['Export Courts'] = await testExportCourts()
  results['Export Inventory'] = await testExportInventory()
  results['Export Coach Bookings'] = await testExportCoachBookings()
  results['Invalid Date Format'] = await testInvalidDateFormat()
  results['Missing Auth Token'] = await testMissingAuth()

  console.log('\n====================================')
  console.log('  Test Summary')
  console.log('====================================')

  const passed = Object.values(results).filter((r) => r).length
  const total = Object.keys(results).length

  Object.entries(results).forEach(([name, result]) => {
    console.log(`${result ? '✓' : '✗'} ${name}`)
  })

  console.log(`\n${passed}/${total} tests passed`)
  console.log('====================================')

  return passed === total
}

// Export for use in test runners
if (typeof module !== 'undefined') {
  module.exports = {
    testIncomeBySource,
    testPaymentMethods,
    testBusinessInsights,
    testExportCourts,
    testExportInventory,
    testExportCoachBookings,
    testInvalidDateFormat,
    testMissingAuth,
    runAllTests,
  }
}

// Run if executed directly
if (
  typeof window === 'undefined' &&
  process.argv[1].includes('analytics.test')
) {
  runAllTests().then((success) => {
    process.exit(success ? 0 : 1)
  })
}
