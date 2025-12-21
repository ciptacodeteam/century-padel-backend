# Analytics APIs - Setup & Testing Guide

## Quick Start

All 4 new analytics endpoints are now implemented and ready for production. They follow the established Hono patterns and are fully integrated into the existing project.

## What Was Added

### 1. **Analytics Service** (`src/services/analytics.service.ts`)

- `getIncomeBySourceAnalytics()` - Analytics by revenue source
- `getPaymentMethodAnalytics()` - Payment method statistics
- `getBusinessAnalytics()` - Comprehensive business insights
- `exportDataToExcel()` - Excel export functionality

### 2. **Handler Updates** (`src/handlers/admin/analytics.handler.ts`)

- `getIncomeBySourceHandler` - Handles income by source requests
- `getPaymentMethodsHandler` - Handles payment method requests
- `getBusinessInsightsHandler` - Handles business insights requests
- `exportBulkDataHandler` - Handles bulk data export requests

### 3. **Route Registration** (`src/routes/admin/analytics.route.ts`)

- Added 4 new GET endpoints to the analytics route

## API Endpoints Summary

| Endpoint                                 | Purpose                                                     | Query Params                   |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| `GET /admin/analytics/income-by-source`  | Revenue by source (online/cashier/class/membership)         | `startDate`, `endDate`         |
| `GET /admin/analytics/payment-methods`   | Payment method adoption & revenue                           | `startDate`, `endDate`         |
| `GET /admin/analytics/business-insights` | Comprehensive KPIs (courts, coaches, inventory, membership) | `startDate`, `endDate`         |
| `GET /admin/analytics/export/bulk-data`  | Export data to Excel                                        | `type`, `startDate`, `endDate` |

## Testing the APIs

### Prerequisites

1. Running backend: `bun run dev` or Docker container
2. Admin authentication token (get from login endpoint)
3. Postman or cURL

### Test Cases

#### 1. Income by Source

```bash
curl -X GET "http://localhost:8787/admin/analytics/income-by-source" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**

- `summary`: Total income, breakdown by source, transaction count
- `bySource`: Detailed transactions per source
- `dateRange`: Query date range

#### 2. Payment Methods

```bash
curl -X GET "http://localhost:8787/admin/analytics/payment-methods" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**

- `summary`: Total amount, method count, transaction count
- `methods`: Each method with count, total, percentage
- `dateRange`: Query date range

#### 3. Business Insights

```bash
curl -X GET "http://localhost:8787/admin/analytics/business-insights" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**

- `courts`: Total, booked, utilization %, top courts
- `coaches`: Total, active, sessions, top coaches
- `inventory`: Items, used, value, utilization %
- `memberships`: Total, active, new, active %
- `bookings`: Total, confirmed, confirmation %
- `revenue`: Total, transactions, average per transaction
- `dateRange`: Query date range

#### 4. Bulk Data Export

```bash
# Export courts
curl -X GET "http://localhost:8787/admin/analytics/export/bulk-data?type=courts" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  --output courts.xlsx

# Export inventory
curl -X GET "http://localhost:8787/admin/analytics/export/bulk-data?type=inventory" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  --output inventory.xlsx

# Export coach bookings (with date range)
curl -X GET "http://localhost:8787/admin/analytics/export/bulk-data?type=coach-bookings&startDate=2024-12-01T00:00:00Z&endDate=2024-12-31T23:59:59Z" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  --output coach-bookings.xlsx
```

## Postman Collection Examples

### Income by Source

```
GET http://localhost:8787/admin/analytics/income-by-source
Headers:
  Authorization: Bearer {{token}}
Params:
  startDate: 2024-12-01T00:00:00Z (optional)
  endDate: 2024-12-31T23:59:59Z (optional)
```

### Payment Methods

```
GET http://localhost:8787/admin/analytics/payment-methods
Headers:
  Authorization: Bearer {{token}}
Params:
  startDate: 2024-12-01T00:00:00Z (optional)
  endDate: 2024-12-31T23:59:59Z (optional)
```

### Business Insights

```
GET http://localhost:8787/admin/analytics/business-insights
Headers:
  Authorization: Bearer {{token}}
Params:
  startDate: 2024-12-01T00:00:00Z (optional)
  endDate: 2024-12-31T23:59:59Z (optional)
```

### Bulk Export

```
GET http://localhost:8787/admin/analytics/export/bulk-data
Headers:
  Authorization: Bearer {{token}}
Params:
  type: courts|inventory|coach-bookings (required)
  startDate: 2024-12-01T00:00:00Z (optional)
  endDate: 2024-12-31T23:59:59Z (optional)
```

## Date Range Parameters

### Format

- ISO 8601 datetime: `YYYY-MM-DDTHH:mm:ssZ`
- Example: `2024-12-19T00:00:00Z`

### Defaults (if not provided)

- **Income, Payment Methods, Business Insights**: Last 30 days
- **Bulk Export**: All data (optional date range for coach-bookings only)

### Example Requests with Date Ranges

```bash
# Last month
curl "http://localhost:8787/admin/analytics/income-by-source?startDate=2024-11-19T00:00:00Z&endDate=2024-12-19T23:59:59Z"

# Last quarter
curl "http://localhost:8787/admin/analytics/payment-methods?startDate=2024-09-01T00:00:00Z&endDate=2024-12-31T23:59:59Z"

# Year-to-date
curl "http://localhost:8787/admin/analytics/business-insights?startDate=2024-01-01T00:00:00Z&endDate=2024-12-31T23:59:59Z"
```

## Response Format

### Success Response (200 OK)

```json
{
  "error": false,
  "data": {
    // endpoint-specific data
  }
}
```

### Error Response (4xx/5xx)

```json
{
  "error": true,
  "message": "Error description",
  "status": 400
}
```

## Production Checklist

- [x] All endpoints implemented and tested
- [x] Proper authentication (ADMIN/ADMIN_VIEWER role required)
- [x] Date validation with Zod
- [x] Error handling and logging
- [x] Consistent response format with `ok()` helper
- [x] TypeScript compilation errors fixed
- [x] Database queries optimized
- [x] Excel export working with proper headers
- [x] Documentation complete

## Performance Considerations

### Database Query Optimization

- Date range filtering is applied at query level (not in memory)
- Distinct queries use database-level deduplication
- Aggregations happen at database level for efficiency
- Proper indexing on common filter fields

### Memory Usage

- Excel exports are streamed to prevent large file issues
- Large result sets use pagination (if needed in future)
- Aggregation queries process results efficiently

### Caching (Optional - Future Enhancement)

- Consider caching business insights for 1 hour
- Cache payment method stats for 30 minutes
- Cache export data if frequent exports are needed

## Monitoring & Logging

### Logged Events

- All handler invocations log errors with context
- Failed database queries are logged with error details
- Export operations log file generation info

### Suggested Alerts

- Long-running analytics queries (> 5s)
- Export file size anomalies
- Failed invoice aggregations

## Troubleshooting

### Issue: Empty Results

**Solution**: Verify date range includes actual data. Default is last 30 days.

### Issue: Authentication Errors (401)

**Solution**: Ensure token is valid and includes ADMIN/ADMIN_VIEWER role.

### Issue: Export File Corrupted

**Solution**: Check browser compatibility. Some browsers require specific CORS headers.

### Issue: Database Connection Errors

**Solution**: Verify PostgreSQL is running and connection string is correct in `.env`.

## Integration Examples

### Frontend - React Component Example

```typescript
// Get income analytics
const fetchIncomeAnalytics = async () => {
  const response = await fetch(
    '/admin/analytics/income-by-source?startDate=2024-12-01T00:00:00Z',
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  const { data } = await response.json()
  return data
}

// Export data
const downloadCoachBookings = async () => {
  const response = await fetch(
    '/admin/analytics/export/bulk-data?type=coach-bookings',
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'coach-bookings.xlsx'
  a.click()
}
```

## Code Structure

```
src/
├── services/
│   └── analytics.service.ts          # Business logic
├── handlers/admin/
│   └── analytics.handler.ts          # Request handlers
├── routes/admin/
│   └── analytics.route.ts            # Route definitions
└── app.ts                            # Route mounting
```

## Related Files

- [ANALYTICS_APIS.md](./ANALYTICS_APIS.md) - Full API documentation
- [src/services/analytics.service.ts](../src/services/analytics.service.ts) - Service implementation
- [src/handlers/admin/analytics.handler.ts](../src/handlers/admin/analytics.handler.ts) - Handler implementation
- [src/routes/admin/analytics.route.ts](../src/routes/admin/analytics.route.ts) - Route definitions

## Next Steps

1. **Deploy to Staging**: Test with realistic data volume
2. **Monitor Performance**: Track query execution times
3. **Gather Feedback**: Collect user feedback on data format
4. **Optimize if Needed**: Add caching or indexes based on usage patterns
5. **Plan Enhancements**: Future analytics features (trends, forecasting, etc.)

## Support & Questions

For issues or questions:

1. Check troubleshooting section
2. Review API documentation
3. Check database logs for query errors
4. Verify authentication and authorization
