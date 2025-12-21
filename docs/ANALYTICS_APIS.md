# Analytics APIs - Complete Documentation

## Overview

The analytics APIs provide comprehensive insights into the padel court business operations, including income analysis, payment method tracking, and business metrics.

## Authentication

All analytics endpoints require `ADMIN` or `ADMIN_VIEWER` role authentication.

## New Endpoints

### 1. Income by Source Analytics

**GET** `/admin/analytics/income-by-source`

Get income analytics separated by source (online vs cashier booking, class booking, membership).

#### Query Parameters

- `startDate` (optional): ISO datetime string - Start date for analysis
- `endDate` (optional): ISO datetime string - End date for analysis
- Default: Last 30 days

#### Response Example

```json
{
  "data": {
    "summary": {
      "totalIncome": 5000000,
      "onlineBookingIncome": 3000000,
      "cashierBookingIncome": 1500000,
      "classBookingIncome": 400000,
      "membershipIncome": 100000,
      "totalTransactions": 125
    },
    "bySource": {
      "Online": {
        "count": 60,
        "total": 3000000,
        "transactions": [
          {
            "id": "inv_123",
            "bookingId": "book_456",
            "amount": 50000,
            "date": "2024-01-15T10:30:00Z"
          }
        ]
      },
      "Cashier": {
        "count": 45,
        "total": 1500000,
        "transactions": []
      },
      "Class Bookings": {
        "count": 15,
        "total": 400000,
        "transactions": []
      },
      "Membership": {
        "count": 5,
        "total": 100000,
        "transactions": []
      }
    },
    "dateRange": {
      "startDate": "2024-12-19T00:00:00Z",
      "endDate": "2024-12-20T23:59:59Z"
    }
  }
}
```

#### Use Cases

- Revenue tracking by channel (online vs in-person sales)
- Understanding customer acquisition patterns
- Identifying most profitable revenue streams
- Monthly/quarterly performance reports

---

### 2. Payment Method Analytics

**GET** `/admin/analytics/payment-methods`

Get payment method analytics showing which payment methods drive revenue and user adoption.

#### Query Parameters

- `startDate` (optional): ISO datetime string - Start date for analysis
- `endDate` (optional): ISO datetime string - End date for analysis
- Default: Last 30 days

#### Response Example

```json
{
  "data": {
    "summary": {
      "totalAmount": 5000000,
      "totalTransactions": 125,
      "methodCount": 4
    },
    "methods": {
      "Bank Transfer": {
        "count": 50,
        "total": 2500000,
        "percentage": 50.0,
        "method": {
          "id": "pm_456",
          "name": "Bank Transfer"
        }
      },
      "Credit Card": {
        "count": 40,
        "total": 2000000,
        "percentage": 40.0,
        "method": {
          "id": "pm_789",
          "name": "Credit Card"
        }
      },
      "E-Wallet": {
        "count": 25,
        "total": 500000,
        "percentage": 10.0,
        "method": {
          "id": "pm_101",
          "name": "E-Wallet"
        }
      },
      "Cash": {
        "count": 10,
        "total": 0,
        "percentage": 0.0,
        "method": {
          "id": "pm_202",
          "name": "Cash"
        }
      }
    },
    "dateRange": {
      "startDate": "2024-12-19T00:00:00Z",
      "endDate": "2024-12-20T23:59:59Z"
    }
  }
}
```

#### Use Cases

- Understanding payment preferences
- Optimizing payment gateway fees
- Identifying popular payment methods
- Improving payment infrastructure

---

### 3. Business Insights Analytics

**GET** `/admin/analytics/business-insights`

Comprehensive business analytics across courts, coaches, inventory, and memberships.

#### Query Parameters

- `startDate` (optional): ISO datetime string - Start date for analysis
- `endDate` (optional): ISO datetime string - End date for analysis
- Default: Last 30 days

#### Response Example

```json
{
  "data": {
    "courts": {
      "total": 4,
      "booked": 3,
      "utilization": "75.00%",
      "topCourts": [
        {
          "court": {
            "id": "court_123",
            "name": "Court A"
          },
          "bookings": 45
        },
        {
          "court": {
            "id": "court_456",
            "name": "Court B"
          },
          "bookings": 38
        }
      ]
    },
    "coaches": {
      "total": 8,
      "active": 6,
      "totalSessions": 120,
      "topCoaches": [
        {
          "coach": {
            "id": "coach_123",
            "name": "Ahmad"
          },
          "sessions": 30
        },
        {
          "coach": {
            "id": "coach_456",
            "name": "Budi"
          },
          "sessions": 25
        }
      ]
    },
    "inventory": {
      "totalItems": 150,
      "itemsUsed": 87,
      "totalValue": 50000000,
      "utilizationRate": "58.00%"
    },
    "memberships": {
      "total": 45,
      "active": 32,
      "newInPeriod": 5,
      "activePercentage": "71.11%"
    },
    "bookings": {
      "total": 250,
      "confirmed": 230,
      "confirmationRate": "92.00%"
    },
    "revenue": {
      "total": 5000000,
      "transactions": 125,
      "avgPerTransaction": "40000.00"
    },
    "dateRange": {
      "startDate": "2024-12-19T00:00:00Z",
      "endDate": "2024-12-20T23:59:59Z"
    }
  }
}
```

#### Metrics Explained

- **Court Utilization**: Percentage of courts with at least one booking
- **Coach Activity**: Active coaches and total sessions conducted
- **Inventory Utilization**: Percentage of inventory items used in bookings
- **Membership Health**: Active memberships and engagement rate
- **Booking Confirmation Rate**: Percentage of bookings confirmed vs created
- **Average Transaction Value**: Total revenue divided by transaction count

#### Use Cases

- Executive dashboards and KPI tracking
- Performance benchmarking
- Resource optimization (courts, coaches, inventory)
- Business strategy decisions

---

### 4. Bulk Data Export to Excel

**GET** `/admin/analytics/export/bulk-data`

Export courts, inventory, or coach booking data to Excel spreadsheet.

#### Query Parameters

- `type` (required): `'courts'` | `'inventory'` | `'coach-bookings'`
- `startDate` (optional): ISO datetime string - Only applies to coach-bookings
- `endDate` (optional): ISO datetime string - Only applies to coach-bookings

#### Response

Returns Excel file with appropriate sheet(s) and data.

#### Export Types

##### Courts Export

Columns:

- Court ID
- Court Name
- Court Type
- Total Slots
- Current Cost (IDR)
- Created At

##### Inventory Export

Columns:

- Item ID
- Item Name
- Category
- Stock Quantity
- Unit Price (IDR)
- Total Value (IDR)
- Created At

##### Coach Bookings Export

Columns:

- Booking ID
- Coach
- Customer Name
- Customer Email
- Date
- Time
- Total Amount (IDR)
- Booking Date

#### Usage Examples

```bash
# Export all courts
curl "http://localhost:8787/admin/analytics/export/bulk-data?type=courts" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export inventory
curl "http://localhost:8787/admin/analytics/export/bulk-data?type=inventory" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export coach bookings for date range
curl "http://localhost:8787/admin/analytics/export/bulk-data?type=coach-bookings&startDate=2024-12-01T00:00:00Z&endDate=2024-12-31T23:59:59Z" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Use Cases

- Data analysis in Excel/Google Sheets
- Report generation
- Data backup
- Integration with external systems

---

## Existing Endpoints (Reference)

### GET `/admin/analytics`

Overview analytics with total transactions, revenue, and monthly trends.

### GET `/admin/analytics/dashboard`

Dashboard statistics with key metrics.

### GET `/admin/analytics/daily-transactions`

Daily transaction breakdown.

### GET `/admin/analytics/export/excel`

Export current analytics to Excel.

---

## Implementation Details

### Date Range Defaults

If `startDate` or `endDate` are not provided:

- **Income/Payment/Business Insights**: Default to last 30 days
- **Bulk Export**: Default to all data (optional date range)

### Error Handling

All endpoints follow standard error response format:

```json
{
  "error": true,
  "message": "Error description",
  "status": 400
}
```

### Performance Considerations

- All queries are optimized with proper indexing
- Date range filtering reduces data processing
- Bulk exports are streamed to prevent memory issues
- Aggregation queries use database-level grouping

### Authentication

Requires:

- Valid JWT token in Authorization header
- Role: `ADMIN` or `ADMIN_VIEWER`

---

## Testing the APIs

### Using cURL

```bash
# Income by source (last 30 days)
curl "http://localhost:8787/admin/analytics/income-by-source" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Payment methods (custom date range)
curl "http://localhost:8787/admin/analytics/payment-methods?startDate=2024-12-01T00:00:00Z&endDate=2024-12-31T23:59:59Z" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Business insights
curl "http://localhost:8787/admin/analytics/business-insights" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export coach bookings
curl "http://localhost:8787/admin/analytics/export/bulk-data?type=coach-bookings" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  --output coach-bookings.xlsx
```

### Using Postman

1. Create requests for each endpoint
2. Set Authorization header with Bearer token
3. Test with different date ranges
4. Verify export file content

---

## Production Deployment Checklist

- [x] Authentication middleware properly enforced
- [x] Date validation and error handling
- [x] Query optimization and indexing
- [x] Error logging implemented
- [x] Response formatting consistent
- [x] Export file naming with timestamps
- [x] Proper HTTP status codes
- [x] CORS headers configured
- [x] Rate limiting ready (if needed)
- [x] Database connection pooling
