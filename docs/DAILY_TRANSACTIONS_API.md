# Daily Transactions Analytics API

## Overview

This API endpoint provides daily transaction counts for chart visualization with flexible time period filters. The data is 100% accurate, sourced directly from paid invoices.

## Endpoint

### GET /admin/analytics/daily-transactions

Get daily transaction counts grouped by date for analytics charts.

**Authentication Required:** Yes (Admin)

**Query Parameters:**

- `period` (optional): Time period for the data
  - `7days` - Last 7 days
  - `30days` - Last 30 days (default)
  - `3months` - Last 3 months (90 days)

**Request Examples:**

```bash
# Last 30 days (default)
GET /admin/analytics/daily-transactions

# Last 7 days
GET /admin/analytics/daily-transactions?period=7days

# Last 3 months
GET /admin/analytics/daily-transactions?period=3months
```

## Response Format

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "chartData": [
      { "date": "2025-10-18", "total": 0 },
      { "date": "2025-10-19", "total": 5 },
      { "date": "2025-10-20", "total": 12 },
      { "date": "2025-10-21", "total": 8 },
      { "date": "2025-10-22", "total": 15 },
      { "date": "2025-10-23", "total": 22 },
      { "date": "2025-10-24", "total": 18 },
      { "date": "2025-10-25", "total": 0 },
      { "date": "2025-10-26", "total": 25 },
      { "date": "2025-10-27", "total": 20 },
      { "date": "2025-10-28", "total": 16 }
    ],
    "summary": {
      "period": "30days",
      "totalTransactions": 141,
      "totalRevenue": 28500000,
      "averagePerDay": 4.7,
      "daysWithTransactions": 25,
      "dateRange": {
        "start": "2025-10-18",
        "end": "2025-11-17"
      }
    }
  }
}
```

## Data Structure

### chartData Array

Each object in the array contains:

- `date` (string): Date in YYYY-MM-DD format
- `total` (number): Number of paid transactions on that date

**Key Features:**

- ✅ Includes ALL dates in the range (even days with 0 transactions)
- ✅ Sorted chronologically from oldest to newest
- ✅ Consistent date format for easy charting
- ✅ Always matches the exact number of days for the period

### summary Object

Provides aggregate statistics:

- `period`: The selected time period
- `totalTransactions`: Total number of paid transactions in the period
- `totalRevenue`: Sum of all transaction amounts
- `averagePerDay`: Average transactions per day (total / number of days)
- `daysWithTransactions`: Count of days that had at least one transaction
- `dateRange`: Start and end dates of the period

## Data Accuracy Guarantee

### 100% Accurate Calculation Method

**Step 1: Fetch paid invoices**

```typescript
const invoices = await db.invoice.findMany({
  where: {
    status: PaymentStatus.PAID,
    paidAt: { gte: startDate, lte: endDate },
  },
  select: { id: true, total: true, paidAt: true },
  orderBy: { paidAt: 'asc' },
})
```

**Step 2: Group by date**

```typescript
const transactionsByDate: { [key: string]: number } = {}
invoices.forEach((invoice) => {
  if (invoice.paidAt) {
    const dateKey = dayjs(invoice.paidAt).format('YYYY-MM-DD')
    transactionsByDate[dateKey] = (transactionsByDate[dateKey] || 0) + 1
  }
})
```

**Step 3: Fill complete date range**

```typescript
for (let i = daysToShow - 1; i >= 0; i--) {
  const date = now.subtract(i, 'days').format('YYYY-MM-DD')
  chartData.push({
    date,
    total: transactionsByDate[date] || 0,
  })
}
```

This ensures:

- ✅ Every day is represented (no gaps)
- ✅ Days without transactions show as 0
- ✅ Transactions are counted exactly once per invoice
- ✅ Only PAID invoices are counted

## Period Definitions

### 7 Days

- **Days shown:** 7
- **Start:** Today minus 6 days (at 00:00:00)
- **End:** Today (at 23:59:59)
- **Use case:** Short-term trends, weekly performance

### 30 Days (Default)

- **Days shown:** 30
- **Start:** Today minus 29 days (at 00:00:00)
- **End:** Today (at 23:59:59)
- **Use case:** Monthly trends, standard reporting

### 3 Months

- **Days shown:** 90
- **Start:** Today minus 89 days (at 00:00:00)
- **End:** Today (at 23:59:59)
- **Use case:** Quarterly analysis, long-term trends

## Frontend Integration

### React/Next.js Example

```typescript
interface DailyTransaction {
  date: string
  total: number
}

interface DailyTransactionsResponse {
  chartData: DailyTransaction[]
  summary: {
    period: string
    totalTransactions: number
    totalRevenue: number
    averagePerDay: number
    daysWithTransactions: number
    dateRange: {
      start: string
      end: string
    }
  }
}

async function fetchDailyTransactions(
  period: '7days' | '30days' | '3months' = '30days'
): Promise<DailyTransactionsResponse> {
  const response = await fetch(
    `/admin/analytics/daily-transactions?period=${period}`,
    {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`
      }
    }
  )
  const { data } = await response.json()
  return data
}

// Usage with chart library (e.g., Recharts)
function TransactionsChart() {
  const [period, setPeriod] = useState<'7days' | '30days' | '3months'>('30days')
  const [data, setData] = useState<DailyTransactionsResponse | null>(null)

  useEffect(() => {
    fetchDailyTransactions(period).then(setData)
  }, [period])

  if (!data) return <Loading />

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setPeriod('7days')}>Last 7 Days</button>
        <button onClick={() => setPeriod('30days')}>Last 30 Days</button>
        <button onClick={() => setPeriod('3months')}>Last 3 Months</button>
      </div>

      <LineChart width={800} height={400} data={data.chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="total" stroke="#8884d8" />
      </LineChart>

      <div className="mt-4">
        <p>Total Transactions: {data.summary.totalTransactions}</p>
        <p>Average per Day: {data.summary.averagePerDay}</p>
        <p>Total Revenue: Rp {data.summary.totalRevenue.toLocaleString()}</p>
      </div>
    </div>
  )
}
```

### Chart.js Example

```typescript
import { Chart } from 'chart.js'

async function renderTransactionsChart(period: string) {
  const response = await fetchDailyTransactions(period)
  const { chartData } = response

  const ctx = document.getElementById('transactionsChart') as HTMLCanvasElement

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.map((d) => d.date),
      datasets: [
        {
          label: 'Daily Transactions',
          data: chartData.map((d) => d.total),
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Daily Transactions',
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
          },
        },
      },
    },
  })
}
```

## Validation & Testing

### Manual Verification Query

```sql
-- Verify transaction count for a specific date
SELECT
  DATE(paid_at) as transaction_date,
  COUNT(*) as transaction_count,
  SUM(total) as total_revenue
FROM invoice
WHERE status = 'PAID'
  AND paid_at >= '2025-10-18 00:00:00'
  AND paid_at <= '2025-11-17 23:59:59'
GROUP BY DATE(paid_at)
ORDER BY transaction_date;
```

### Test Cases

1. **Zero Transaction Days**: Days with no transactions show `total: 0`
2. **Consecutive Days**: All days between start and end are included
3. **Date Format**: All dates follow YYYY-MM-DD format
4. **Count Accuracy**: Each paid invoice counted exactly once
5. **Period Filtering**: Only transactions within the period are included

### Expected Behavior

```typescript
// Test: 7 days should return exactly 7 entries
const result7 = await fetch('/admin/analytics/daily-transactions?period=7days')
assert(result7.data.chartData.length === 7)

// Test: 30 days should return exactly 30 entries
const result30 = await fetch(
  '/admin/analytics/daily-transactions?period=30days',
)
assert(result30.data.chartData.length === 30)

// Test: 3 months should return exactly 90 entries
const result90 = await fetch(
  '/admin/analytics/daily-transactions?period=3months',
)
assert(result90.data.chartData.length === 90)

// Test: Total should match sum of daily totals
const totalFromDaily = result30.data.chartData.reduce(
  (sum, d) => sum + d.total,
  0,
)
assert(totalFromDaily === result30.data.summary.totalTransactions)
```

## Performance Considerations

1. **Indexed Queries**: Uses indexed columns (status, paidAt)
2. **Selective Fields**: Only fetches necessary columns
3. **Single Query**: One database query per request
4. **Client-side Grouping**: Efficient date grouping in application layer
5. **Caching Recommended**: Consider caching for frequently accessed periods

### Optimization Tips

```typescript
// Cache results for better performance
const cache = new Map()

async function getCachedDailyTransactions(period: string) {
  const cacheKey = `daily-tx-${period}-${dayjs().format('YYYY-MM-DD')}`

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  const data = await fetchDailyTransactions(period)
  cache.set(cacheKey, data)

  return data
}
```

## Error Handling

### Possible Errors

- `400 Bad Request`: Invalid period parameter
- `401 Unauthorized`: Missing or invalid auth token
- `403 Forbidden`: User is not an admin
- `500 Internal Server Error`: Database error

### Error Response Format

```json
{
  "success": false,
  "code": 400,
  "msg": "Invalid period parameter",
  "errors": "Period must be one of: 7days, 30days, 3months"
}
```

## Use Cases

1. **Dashboard Charts**: Display transaction trends over time
2. **Performance Monitoring**: Track daily sales patterns
3. **Trend Analysis**: Identify high/low activity days
4. **Forecasting**: Use historical data for predictions
5. **Reporting**: Generate visual reports for stakeholders

## Related Endpoints

- `GET /admin/analytics/dashboard` - Dashboard statistics overview
- `GET /admin/analytics` - Detailed analytics with monthly trends
- `GET /admin/analytics/export/excel` - Export analytics to Excel

## Status Codes

- `200 OK` - Successfully retrieved transaction data
- `400 Bad Request` - Invalid query parameters
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - User is not an admin
- `500 Internal Server Error` - Server error occurred
