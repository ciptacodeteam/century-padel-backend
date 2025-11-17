# Dashboard Statistics API

## Overview

This API endpoint provides accurate, real-time dashboard statistics for the admin panel, including revenue metrics, sales performance, customer acquisition, and user engagement data.

## Endpoint

### GET /admin/analytics/dashboard

Get comprehensive dashboard statistics with month-over-month comparisons.

**Authentication Required:** Yes (Admin)

**Request:**

```
GET /admin/analytics/dashboard
Authorization: Bearer <admin_token>
```

**Response:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalRevenue": {
      "value": 2000000,
      "formatted": "Rp 2.000.000",
      "percentageChange": 12.5,
      "trend": "up",
      "description": "Trending up this month",
      "subtitle": "Visitors for the last 6 months"
    },
    "totalSales": {
      "value": 500,
      "percentageChange": 4.5,
      "trend": "up",
      "description": "Steady performance increase",
      "subtitle": "Meets growth projections"
    },
    "newCustomers": {
      "value": 321,
      "percentageChange": -20,
      "trend": "down",
      "description": "Down 20% this period",
      "subtitle": "Acquisition needs attention"
    },
    "activeAccounts": {
      "value": 12,
      "percentageChange": 12.5,
      "trend": "up",
      "description": "Strong user retention",
      "subtitle": "Engagement exceed targets"
    },
    "period": {
      "current": {
        "start": "2025-11-01",
        "end": "2025-11-17"
      },
      "previous": {
        "start": "2025-10-01",
        "end": "2025-10-31"
      }
    },
    "revenueHistory": {
      "last6Months": [
        {
          "month": "2025-06",
          "revenue": 1500000
        },
        {
          "month": "2025-07",
          "revenue": 1700000
        },
        {
          "month": "2025-08",
          "revenue": 1800000
        },
        {
          "month": "2025-09",
          "revenue": 1750000
        },
        {
          "month": "2025-10",
          "revenue": 1900000
        },
        {
          "month": "2025-11",
          "revenue": 2000000
        }
      ],
      "trend": "up"
    }
  }
}
```

## Metrics Explained

### 1. Total Revenue

- **Calculation:** Sum of all paid invoice totals in the current month
- **Comparison:** Compared to previous month's revenue
- **Trend:** Calculated from last 6 months revenue pattern
- **Accuracy:** 100% - Direct aggregation from Invoice table with PaymentStatus.PAID

### 2. Total Sales

- **Calculation:** Count of all paid invoices in the current month
- **Comparison:** Compared to previous month's sales count
- **Includes:** Bookings, class bookings, and membership transactions
- **Accuracy:** 100% - Direct count from Invoice table

### 3. New Customers

- **Calculation:** Count of User records created in the current month
- **Comparison:** Compared to previous month's new users
- **Tracking:** Based on User.createdAt timestamp
- **Accuracy:** 100% - Direct count from User table

### 4. Active Accounts

- **Calculation:** Unique count of users who made at least one paid transaction in the current month
- **Comparison:** Compared to previous month's active users
- **Method:** Extracts unique userId from paid invoices
- **Accuracy:** 100% - Set-based deduplication ensures unique user count

## Data Validation

### Revenue Calculation

```sql
-- Current Month Revenue
SELECT SUM(total) FROM invoice
WHERE status = 'PAID'
AND paidAt >= '2025-11-01'
AND paidAt <= '2025-11-17'

-- Previous Month Revenue
SELECT SUM(total) FROM invoice
WHERE status = 'PAID'
AND paidAt >= '2025-10-01'
AND paidAt <= '2025-10-31'
```

### Sales Calculation

```sql
-- Current Month Sales
SELECT COUNT(*) FROM invoice
WHERE status = 'PAID'
AND paidAt >= '2025-11-01'
AND paidAt <= '2025-11-17'
```

### New Customers Calculation

```sql
-- Current Month New Customers
SELECT COUNT(*) FROM user
WHERE createdAt >= '2025-11-01'
AND createdAt <= '2025-11-17'
```

### Active Accounts Calculation

```sql
-- Current Month Active Accounts
SELECT COUNT(DISTINCT userId) FROM invoice
WHERE status = 'PAID'
AND paidAt >= '2025-11-01'
AND paidAt <= '2025-11-17'
AND userId IS NOT NULL
```

## Percentage Change Formula

```typescript
percentageChange =
  previousValue > 0
    ? (((currentValue - previousValue) / previousValue) * 100).toFixed(1)
    : currentValue > 0
      ? 100
      : 0
```

## Trend Determination

- **up:** Percentage change > 0
- **down:** Percentage change < 0
- **stable:** Percentage change = 0

## Period Definitions

- **Current Period:** From start of current month to current date
- **Previous Period:** Entire previous month (start to end)
- **Last 6 Months:** From 6 months ago (start of month) to current date

## Error Handling

All errors are caught and logged:

```typescript
catch (error) {
  c.var.logger.fatal(`Error in getDashboardStatsHandler: ${error}`)
  throw error
}
```

## Usage Example

```typescript
// Frontend fetch example
const response = await fetch('/admin/analytics/dashboard', {
  headers: {
    Authorization: `Bearer ${adminToken}`,
  },
})

const { data } = await response.json()

// Display total revenue
console.log(`Revenue: ${data.totalRevenue.formatted}`)
console.log(`Change: ${data.totalRevenue.percentageChange}%`)
console.log(`Trend: ${data.totalRevenue.trend}`)
```

## Performance Considerations

1. **Optimized Queries:** Uses Prisma aggregate functions for efficient calculations
2. **Minimal Data Transfer:** Only essential fields are selected
3. **Index Usage:** Relies on indexed columns (paidAt, createdAt, status)
4. **Set Operations:** Uses JavaScript Set for efficient unique user counting

## Testing Recommendations

1. **Verify Revenue:** Compare with manual sum of paid invoices
2. **Verify Sales Count:** Compare with manual count of paid invoices
3. **Verify New Customers:** Compare with manual count of new users
4. **Verify Active Accounts:** Compare with manual distinct user count from invoices
5. **Test Edge Cases:**
   - No data in current month
   - No data in previous month
   - First month of operation
   - Zero revenue periods

## Related Endpoints

- `GET /admin/analytics` - Detailed analytics with monthly trends
- `GET /admin/analytics/export/excel` - Export analytics to Excel

## Status Codes

- `200 OK` - Successfully retrieved dashboard statistics
- `401 Unauthorized` - Missing or invalid authentication token
- `403 Forbidden` - User is not an admin
- `500 Internal Server Error` - Server error occurred
