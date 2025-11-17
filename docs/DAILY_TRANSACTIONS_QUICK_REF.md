# Daily Transactions API - Quick Reference

## Endpoint

```
GET /admin/analytics/daily-transactions?period={7days|30days|3months}
```

## Query Parameters

- `period` (optional, default: `30days`)
  - `7days` - Last 7 days
  - `30days` - Last 30 days
  - `3months` - Last 3 months (90 days)

## Response Format

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "chartData": [
      { "date": "2025-10-18", "total": 15 },
      { "date": "2025-10-19", "total": 22 },
      { "date": "2025-10-20", "total": 18 }
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

## chartData Format

```typescript
{
  date: string,      // YYYY-MM-DD format
  total: number      // Number of paid transactions on that date
}
```

## Key Features

✅ **100% Accurate** - Direct count from paid invoices
✅ **Complete Date Range** - Includes all dates (even zero-transaction days)
✅ **Flexible Periods** - 7 days, 30 days, or 3 months
✅ **Chronologically Sorted** - Oldest to newest
✅ **Summary Statistics** - Total, average, and revenue included

## Quick Test

```bash
# Last 7 days
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/admin/analytics/daily-transactions?period=7days

# Last 30 days (default)
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/admin/analytics/daily-transactions

# Last 3 months
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/admin/analytics/daily-transactions?period=3months
```

## Frontend Usage

```typescript
// Fetch data
const response = await fetch(
  '/admin/analytics/daily-transactions?period=30days',
  { headers: { Authorization: `Bearer ${token}` } },
)
const { data } = await response.json()

// Use in chart
const chartData = data.chartData // Ready for any chart library!

// Display summary
console.log('Total Transactions:', data.summary.totalTransactions)
console.log('Average per Day:', data.summary.averagePerDay)
console.log('Total Revenue:', data.summary.totalRevenue)
```

## Chart Library Examples

### Recharts

```tsx
<LineChart data={data.chartData}>
  <XAxis dataKey="date" />
  <YAxis />
  <Line dataKey="total" stroke="#8884d8" />
</LineChart>
```

### Chart.js

```typescript
new Chart(ctx, {
  type: 'line',
  data: {
    labels: chartData.map((d) => d.date),
    datasets: [
      {
        data: chartData.map((d) => d.total),
      },
    ],
  },
})
```

### ApexCharts

```typescript
const options = {
  series: [
    {
      name: 'Transactions',
      data: chartData.map((d) => d.total),
    },
  ],
  xaxis: {
    categories: chartData.map((d) => d.date),
  },
}
```

## Data Accuracy Guarantee

- ✅ Only counts `PAID` status invoices
- ✅ Each invoice counted exactly once
- ✅ All dates in range included (0 for no transactions)
- ✅ Real-time data (includes today)
- ✅ Verified with direct database queries

## Common Use Cases

1. **Line Chart** - Show daily transaction trends
2. **Bar Chart** - Compare daily transaction volumes
3. **Area Chart** - Visualize transaction flow over time
4. **Heatmap** - Show transaction intensity by date
5. **Reports** - Export data for business analysis
